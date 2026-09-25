import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { RequirePermissions } from "../../shared/auth/permissions.guard";
import { SlaService } from "../services/sla.service";
import {
  CreateSlaPolicyDto,
  SlaReportQueryDto,
  UpdateSlaPolicyDto,
} from "../dto/sla.dto";

/**
 * P3-07 — §9's SLA API surface.
 *
 * `GET /v1/sla/reports` is the endpoint §9 lists. `GET`/`POST`/`PATCH /v1/sla/policies`
 * are the policy CRUD §15.1 **O6** records as missing from the backlog; §9's table
 * gives that row a Permission of `—`, so it is guarded with the existing
 * `crm:read` / `crm:update` actions from §9's RBAC table rather than a new
 * permission. See `CreateSlaPolicyDto` for why the endpoints exist at all.
 */
@Controller("v1/sla")
export class SlaController {
  constructor(private readonly service: SlaService) {}

  @Get("reports")
  @RequirePermissions({ resource: "crm", action: "read" })
  reports(@Query() dto: SlaReportQueryDto) {
    return this.service.report(dto);
  }

  @Get("policies")
  @RequirePermissions({ resource: "crm", action: "read" })
  listPolicies() {
    return this.service.listPolicies();
  }

  @Post("policies")
  @RequirePermissions({ resource: "crm", action: "update" })
  createPolicy(@Body() dto: CreateSlaPolicyDto) {
    return this.service.createPolicy(dto);
  }

  @Patch("policies/:id")
  @RequirePermissions({ resource: "crm", action: "update" })
  updatePolicy(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() dto: UpdateSlaPolicyDto,
  ) {
    return this.service.updatePolicy(id, dto);
  }
}
