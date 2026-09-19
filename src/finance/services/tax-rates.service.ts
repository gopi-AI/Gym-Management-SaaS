import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, In } from 'typeorm';
import { TaxRate } from '../entities/tax-rate.entity';
import { CreateTaxRateDto } from '../dto/create-tax-rate.dto';
import { QueryTaxRateDto } from '../dto/query-tax-rate.dto';
import { TenantContextService } from '../../shared/tenant/tenant-context.service';

/**
 * P3-04 — tax rate configuration (`docs/phase3-scoping-plan.md` §4).
 *
 * Rates are PER ORGANIZATION (§15 Q6 ruling). Every method resolves the authorized
 * organization from the tenant context and scopes both reads and writes by it, so a
 * caller can neither read nor create a rate in another tenant.
 *
 * This service owns the rates table only. Applying a rate to an invoice is
 * `InvoicesService`'s job; the arithmetic itself lives in `finance.constants.ts`
 * (§4: all money arithmetic is rounded to 2 decimals in exactly one place).
 */
@Injectable()
export class TaxRatesService {
  constructor(
    @InjectRepository(TaxRate)
    private readonly taxRateRepository: Repository<TaxRate>,
    private readonly tenantContextService: TenantContextService,
  ) {}

  /** Authorized organization, mirroring InvoicesService.resolveAuthorizedOrg. */
  private async resolveAuthorizedOrg(): Promise<string> {
    const currentOrgId = await this.tenantContextService.getCurrentOrganizationId();
    if (currentOrgId) return currentOrgId;
    const requestedOrgId = await this.tenantContextService.getRequestedOrganizationId();
    if (!requestedOrgId) throw new ForbiddenException('Organization context required');
    return this.tenantContextService.requireOrganizationAccess(requestedOrgId);
  }

  /** Paginated, tenant-scoped rate list. */
  async findAll(query: QueryTaxRateDto): Promise<{
    data: TaxRate[];
    total: number;
    page: number;
    limit: number;
  }> {
    const organizationId = await this.resolveAuthorizedOrg();
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;

    const where: Record<string, unknown> = { organization_id: organizationId };
    if (query.is_active !== undefined) {
      where.is_active = query.is_active;
    }

    const [data, total] = await this.taxRateRepository.findAndCount({
      where,
      order: { code: 'ASC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<TaxRate> {
    const organizationId = await this.resolveAuthorizedOrg();
    const rate = await this.taxRateRepository.findOne({
      where: { id, organization_id: organizationId },
    });
    if (!rate) {
      throw new NotFoundException('Tax rate not found');
    }
    return rate;
  }

  /**
   * Create a rate (`POST /v1/tax-rates`).
   *
   * `code` is upper-cased before the duplicate check AND before the insert, so the
   * check and the write agree: lower-casing only at insert time would let a
   * concurrent `gst` slip past a check for `GST`. The `(organization_id, code)`
   * unique index is the actual backstop; the lookup exists to return a 409 rather
   * than a raw driver error.
   */
  async create(dto: CreateTaxRateDto): Promise<TaxRate> {
    const organizationId = await this.resolveAuthorizedOrg();
    const code = dto.code.toUpperCase();

    const existing = await this.taxRateRepository.findOne({
      where: { organization_id: organizationId, code },
    });
    if (existing) {
      throw new ConflictException(`A tax rate with code ${code} already exists`);
    }

    const isInclusive = dto.is_inclusive ?? false;
    const rate = Number(dto.rate);
    // Mirrors the CHK_finance_tax_rates_rate_range constraint so the caller gets a
    // 400 with a usable message instead of a 500 from the database.
    if (isInclusive && rate >= 100) {
      throw new BadRequestException(
        'An inclusive tax rate must be below 100% (the tax is contained in the amount)',
      );
    }

    const effectiveFrom = dto.effective_from ? new Date(dto.effective_from) : new Date();
    const effectiveTo = dto.effective_to ? new Date(dto.effective_to) : null;
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException('effective_to must not precede effective_from');
    }

    const saved = await this.taxRateRepository.save(
      this.taxRateRepository.create({
        organization_id: organizationId,
        name: dto.name,
        code,
        rate: dto.rate,
        is_inclusive: isInclusive,
        is_active: dto.is_active ?? true,
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
      }),
    );

    return Array.isArray(saved) ? saved[0] : saved;
  }

  /**
   * Resolve a set of `InvoiceItem.tax_code` values to their active rates.
   *
   * Used by `InvoicesService` inside the invoice transaction, so it accepts the
   * caller's `manager` and reads through it — the read then runs on the same
   * connection as the invoice write and cannot land on a different one.
   *
   * Returns a map keyed by the UPPER-CASED code. The effective-date window is
   * filtered here rather than in SQL because "`effective_to` IS NULL OR
   * `effective_to` >= at" is a two-branch condition that TypeORM's object `where`
   * cannot express without an `OR`, and an org has few rates — clarity wins over
   * a query that would need reviewing every time it is read.
   *
   * An unknown, inactive or out-of-window code resolves to nothing, and the caller
   * treats that as an error rather than as zero tax: silently untaxing an invoice
   * because someone typo'd a code is a compliance failure that no test would catch
   * from the outside. An EMPTY code is different — that is a caller who opted out
   * of tax entirely, and it stays tax-free for backwards compatibility.
   *
   * `at` is the instant the rate must be valid at, so an invoice raised today uses
   * the rate in force today rather than a future one that has been pre-configured.
   */
  async resolveActiveRates(
    organizationId: string,
    codes: string[],
    at: Date,
    manager?: EntityManager,
  ): Promise<Map<string, TaxRate>> {
    const resolved = new Map<string, TaxRate>();
    const wanted = TaxRatesService.normaliseCodes(codes);
    if (wanted.length === 0) return resolved;

    const repository = manager
      ? manager.getRepository(TaxRate)
      : this.taxRateRepository;

    const rows = await repository.find({
      where: { organization_id: organizationId, code: In(wanted), is_active: true },
    });

    for (const row of rows) {
      const from = new Date(row.effective_from);
      if (from > at) continue;
      if (row.effective_to && new Date(row.effective_to) < at) continue;
      resolved.set(row.code.toUpperCase(), row);
    }

    return resolved;
  }

  /**
   * Codes that were requested but did not resolve to an active, in-force rate.
   *
   * Returned to the caller so it can reject the invoice with the offending codes
   * named, rather than a generic "invalid tax_code".
   */
  static unresolvedCodes(codes: string[], resolved: Map<string, TaxRate>): string[] {
    return TaxRatesService.normaliseCodes(codes).filter((code) => !resolved.has(code));
  }

  /** Distinct, non-empty, upper-cased codes — the canonical form used everywhere. */
  private static normaliseCodes(codes: string[]): string[] {
    return Array.from(
      new Set(
        codes
          .filter((code) => code && code.trim() !== '')
          .map((code) => code.toUpperCase()),
      ),
    );
  }
}

