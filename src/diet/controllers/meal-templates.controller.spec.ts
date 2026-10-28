import { Reflector } from '@nestjs/core';
import {
  BadRequestException,
  ForbiddenException,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { MealTemplatesController } from './meal-templates.controller';
import {
  PERMISSIONS_KEY,
  PermissionsGuard,
  RequiredPermission,
} from '../../shared/auth/permissions.guard';
import { IdentityService } from '../../identity/services/identity.service';
import { DietService } from '../services/diet.service';
import { CreateMealTemplateDto } from '../dto/create-meal-template.dto';
import { UpdateMealTemplateDto } from '../dto/update-meal-template.dto';
import { QueryMealTemplateDto } from '../dto/query-meal-template.dto';
import { MealType } from '../entities/meal-type.enum';

type Handler = 'findAll' | 'findOne' | 'create' | 'update' | 'remove';

const READ: RequiredPermission = { resource: 'diet', action: 'template-read' };
const MANAGE: RequiredPermission = {
  resource: 'diet',
  action: 'template-manage',
};

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const FOREIGN_PLAN_ID = '33333333-3333-4333-8333-333333333333';

const reflector = new Reflector();

function requiredOn(method: Handler): RequiredPermission[] | undefined {
  return reflector.getAllAndOverride<RequiredPermission[]>(PERMISSIONS_KEY, [
    MealTemplatesController.prototype[method],
    MealTemplatesController,
  ]);
}

function pathOn(method: Handler): string {
  const path = Reflect.getMetadata(
    PATH_METADATA,
    MealTemplatesController.prototype[method],
  ) as string;
  return String(path).replace(/^\/+/, '');
}

function httpMethodOn(method: Handler): RequestMethod {
  return Reflect.getMetadata(
    METHOD_METADATA,
    MealTemplatesController.prototype[method],
  ) as RequestMethod;
}

function httpCodeOn(method: Handler): number | undefined {
  return Reflect.getMetadata(
    HTTP_CODE_METADATA,
    MealTemplatesController.prototype[method],
  ) as number | undefined;
}

describe('MealTemplatesController route + authorization metadata', () => {
  it('mounts the flat collection at v1/meal-templates', () => {
    const prefix = String(
      Reflect.getMetadata(PATH_METADATA, MealTemplatesController),
    ).replace(/^\/+/, '');
    expect(prefix).toBe('v1/meal-templates');
  });

  it.each<[Handler, string, RequestMethod, RequiredPermission]>([
    ['findAll', '', RequestMethod.GET, READ],
    ['findOne', ':id', RequestMethod.GET, READ],
    ['create', '', RequestMethod.POST, MANAGE],
    ['update', ':id', RequestMethod.PATCH, MANAGE],
    ['remove', ':id', RequestMethod.DELETE, MANAGE],
  ])(
    '%s is registered as the %s route with exactly one permission',
    (method, expectedPath, expectedMethod, expectedPermission) => {
      // Path + verb: a route moved under a parent plan id, or a PATCH shipped
      // as a PUT, breaks this without touching the guard assertions below.
      expect(pathOn(method)).toBe(expectedPath);
      expect(httpMethodOn(method)).toBe(expectedMethod);

      // `toEqual` on the whole array: the guard ANDs every entry, so an extra
      // permission would narrow the route and a missing one would open it.
      expect(requiredOn(method)).toEqual([expectedPermission]);
    },
  );

  it.each<[Handler, number]>([
    ['findAll', 200],
    ['findOne', 200],
    ['create', 201],
    ['update', 200],
    ['remove', 204],
  ])('%s answers HTTP %s', (method, expected) => {
    expect(httpCodeOn(method)).toBe(expected);
  });
});
// ---------------------------------------------------------------------------
// Delegation — the controller adds no query and no field of its own
// ---------------------------------------------------------------------------

interface ServiceMock {
  findAllMealTemplates: jest.Mock;
  findMealTemplateById: jest.Mock;
  createMealTemplate: jest.Mock;
  updateMealTemplate: jest.Mock;
  deleteMealTemplate: jest.Mock;
}

function buildController(): {
  service: ServiceMock;
  controller: MealTemplatesController;
} {
  const service: ServiceMock = {
    findAllMealTemplates: jest.fn().mockResolvedValue([]),
    findMealTemplateById: jest.fn().mockResolvedValue({ id: TEMPLATE_ID }),
    createMealTemplate: jest.fn().mockResolvedValue({ id: TEMPLATE_ID }),
    updateMealTemplate: jest.fn().mockResolvedValue({ id: TEMPLATE_ID }),
    deleteMealTemplate: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new MealTemplatesController(
    service as unknown as DietService,
  );
  return { service, controller };
}

describe('MealTemplatesController delegation', () => {
  it('GET /v1/meal-templates lists the organization when no filter is given', async () => {
    const { service, controller } = buildController();
    await expect(controller.findAll({})).resolves.toEqual([]);
    expect(service.findAllMealTemplates).toHaveBeenCalledWith(undefined);
  });

  it('GET /v1/meal-templates?dietPlanId=... forwards the filter untouched', async () => {
    const { service, controller } = buildController();
    await controller.findAll({ dietPlanId: PLAN_ID });
    expect(service.findAllMealTemplates).toHaveBeenCalledWith(PLAN_ID);
  });

  it('GET /v1/meal-templates/:id reads through DietService', async () => {
    const { service, controller } = buildController();
    await expect(controller.findOne(TEMPLATE_ID)).resolves.toEqual({
      id: TEMPLATE_ID,
    });
    expect(service.findMealTemplateById).toHaveBeenCalledWith(TEMPLATE_ID);
  });

  it('POST /v1/meal-templates forwards the create DTO unchanged', async () => {
    const { service, controller } = buildController();
    const dto: CreateMealTemplateDto = {
      dietPlanId: PLAN_ID,
      name: 'Oats',
      mealType: MealType.BREAKFAST,
      calories: 250,
      proteinG: '10.00',
      carbsG: '40.00',
      fatG: '5.00',
      servingSize: '1.00',
    };
    await controller.create(dto);
    expect(service.createMealTemplate).toHaveBeenCalledWith(dto);
  });

  it('PATCH /v1/meal-templates/:id forwards the path id and the update DTO', async () => {
    const { service, controller } = buildController();
    const dto: UpdateMealTemplateDto = { name: 'Oats v2', calories: 300 };
    await controller.update(TEMPLATE_ID, dto);
    expect(service.updateMealTemplate).toHaveBeenCalledWith(TEMPLATE_ID, dto);
  });

  it('DELETE /v1/meal-templates/:id awaits the service (204 carries no body)', async () => {
    const { service, controller } = buildController();
    await expect(controller.remove(TEMPLATE_ID)).resolves.toBeUndefined();
    expect(service.deleteMealTemplate).toHaveBeenCalledWith(TEMPLATE_ID);
  });
});
// ---------------------------------------------------------------------------
// PermissionsGuard driven through the real controller
// ---------------------------------------------------------------------------
//
// Metadata alone cannot show ordering, and a guard in isolation cannot see the
// decorator. Both layers run here against the same handler: the guard first
// (as the global APP_GUARD does), then the handler body.

interface Invocation {
  args: unknown[];
  serviceMethod: keyof ServiceMock;
  permission: RequiredPermission;
}

const INVOCATIONS: Record<Handler, Invocation> = {
  findAll: {
    args: [{ dietPlanId: PLAN_ID }],
    serviceMethod: 'findAllMealTemplates',
    permission: READ,
  },
  findOne: {
    args: [TEMPLATE_ID],
    serviceMethod: 'findMealTemplateById',
    permission: READ,
  },
  create: {
    args: [
      {
        dietPlanId: PLAN_ID,
        name: 'Oats',
        mealType: MealType.BREAKFAST,
        calories: 250,
        proteinG: '10.00',
        carbsG: '40.00',
        fatG: '5.00',
        servingSize: '1.00',
      },
    ],
    serviceMethod: 'createMealTemplate',
    permission: MANAGE,
  },
  update: {
    args: [TEMPLATE_ID, { name: 'Oats v2' }],
    serviceMethod: 'updateMealTemplate',
    permission: MANAGE,
  },
  remove: {
    args: [TEMPLATE_ID],
    serviceMethod: 'deleteMealTemplate',
    permission: MANAGE,
  },
};

function contextFor(
  method: Handler,
  user: { userId: string } | null = { userId: 'user-1' },
): never {
  return {
    getHandler: () => MealTemplatesController.prototype[method],
    getClass: () => MealTemplatesController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as never;
}

function handlerFor(
  controller: MealTemplatesController,
  method: Handler,
): (...args: unknown[]) => Promise<unknown> {
  // Bound: an unbound prototype method would lose `this` and read
  // `this.dietService` off undefined instead of driving the controller.
  return controller[method].bind(controller) as (
    ...args: unknown[]
  ) => Promise<unknown>;
}

function pipelineFor(method: Handler, granted: boolean) {
  const { service, controller } = buildController();
  const identityService = {
    hasPermission: jest.fn().mockResolvedValue(granted),
  };
  const guard = new PermissionsGuard(
    new Reflector(),
    identityService as unknown as IdentityService,
  );
  const { args, serviceMethod, permission } = INVOCATIONS[method];

  const run = async (
    user: { userId: string } | null = { userId: 'user-1' },
  ) => {
    await guard.canActivate(contextFor(method, user));
    await handlerFor(controller, method)(...args);
  };

  return { run, service, serviceMethod, permission, identityService };
}

describe('PermissionsGuard -> meal-template permissions', () => {
  it.each<Handler>(['findAll', 'findOne', 'create', 'update', 'remove'])(
    '%s refuses before the handler body when the permission is missing',
    async (method) => {
      const { run, service, serviceMethod, permission, identityService } =
        pipelineFor(method, false);

      await expect(run()).rejects.toBeInstanceOf(ForbiddenException);
      expect(identityService.hasPermission).toHaveBeenCalledWith(
        'user-1',
        permission.resource,
        permission.action,
      );
      // The guard ran first, so the body — and therefore the service — was
      // never reached. A decorator accidentally dropped in a refactor would
      // make this assertion fail while "the route still 403s for other reasons"
      // could not mask it.
      expect(service[serviceMethod]).not.toHaveBeenCalled();
    },
  );

  it.each<Handler>(['findAll', 'findOne', 'create', 'update', 'remove'])(
    '%s runs the handler exactly once when the permission is granted',
    async (method) => {
      const { run, service, serviceMethod } = pipelineFor(method, true);

      await run();

      expect(service[serviceMethod]).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses an unauthenticated caller without consulting permissions', async () => {
    const { run, service, serviceMethod, identityService } = pipelineFor(
      'findAll',
      true,
    );

    await expect(run(null)).rejects.toBeInstanceOf(ForbiddenException);
    expect(identityService.hasPermission).not.toHaveBeenCalled();
    expect(service[serviceMethod]).not.toHaveBeenCalled();
  });
});
// ---------------------------------------------------------------------------
// ValidationPipe behaviour — the same pipe config as src/main.ts
// ---------------------------------------------------------------------------

describe('MealTemplatesController request validation', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const patchMeta = { type: 'body' as const, metatype: UpdateMealTemplateDto };
  const postMeta = { type: 'body' as const, metatype: CreateMealTemplateDto };
  const queryMeta = {
    type: 'query' as const,
    metatype: QueryMealTemplateDto,
  };

  it('strips organization_id and unknown keys from a PATCH body before the service sees it', async () => {
    const { service, controller } = buildController();
    const piped = await pipe.transform(
      {
        name: 'Renamed',
        organization_id: 'other-org',
        diet_plan_id: FOREIGN_PLAN_ID,
        created_at: '2020-01-01',
        made_up_field: 'x',
      },
      patchMeta,
    );

    expect(Object.keys(piped).sort()).toEqual(['name']);
    await controller.update(TEMPLATE_ID, piped);
    expect(service.updateMealTemplate).toHaveBeenCalledWith(TEMPLATE_ID, {
      name: 'Renamed',
    });
  });

  it('rejects a non-uuid dietPlanId in a PATCH body', async () => {
    await expect(
      pipe.transform({ dietPlanId: 'not-a-uuid' }, patchMeta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown mealType in a PATCH body', async () => {
    await expect(
      pipe.transform({ mealType: 'brunch' }, patchMeta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts an empty PATCH body (every field is optional)', async () => {
    await expect(pipe.transform({}, patchMeta)).resolves.toEqual({});
  });

  it.each([
    'dietPlanId',
    'name',
    'mealType',
    'calories',
    'proteinG',
    'carbsG',
    'fatG',
    'servingSize',
  ])(
    'rejects an explicit null for the NOT NULL column %s instead of forwarding it',
    async (field) => {
      // `@IsOptional()` skips every validator when the value is `null`, so
      // `{"calories": null}` reached PostgreSQL as `SET "calories" = NULL` on a
      // NOT NULL column — a 500 (23502). `@ValidateIf` keeps an ABSENT key
      // valid while turning an explicit `null` into a 400.
      await expect(
        pipe.transform({ [field]: null }, patchMeta),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('keeps description: null a legal request (its column is nullable)', async () => {
    await expect(
      pipe.transform({ description: null }, patchMeta),
    ).resolves.toEqual({ description: null });
  });

  it('strips organization_id from a POST body', async () => {
    const piped = await pipe.transform(
      {
        dietPlanId: PLAN_ID,
        name: 'Oats',
        mealType: MealType.BREAKFAST,
        calories: 250,
        proteinG: '10.00',
        carbsG: '40.00',
        fatG: '5.00',
        servingSize: '1.00',
        organization_id: 'other-org',
      },
      postMeta,
    );

    expect(Object.keys(piped).sort()).toEqual([
      'calories',
      'carbsG',
      'dietPlanId',
      'fatG',
      'mealType',
      'name',
      'proteinG',
      'servingSize',
    ]);
  });

  it('rejects a POST body missing a required field', async () => {
    await expect(
      pipe.transform({ name: 'Oats' }, postMeta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-uuid dietPlanId query value and accepts an absent one', async () => {
    await expect(
      pipe.transform({ dietPlanId: 'nope' }, queryMeta),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({}, queryMeta)).resolves.toEqual({});
    await expect(pipe.transform({ dietPlanId: PLAN_ID }, queryMeta)).resolves.toEqual(
      { dietPlanId: PLAN_ID },
    );
  });
});
