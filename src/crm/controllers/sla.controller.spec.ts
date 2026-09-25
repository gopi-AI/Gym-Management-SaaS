import "reflect-metadata";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { SlaController } from "./sla.controller";
import { PERMISSIONS_KEY } from "../../shared/auth/permissions.guard";

describe("SlaController", () => {
  it("delegates the report and policy routes", async () => {
    const service: any = {
      report: jest.fn(),
      listPolicies: jest.fn(),
      createPolicy: jest.fn(),
      updatePolicy: jest.fn(),
    };
    const controller = new SlaController(service);

    await controller.reports({ from: "2026-03-01T00:00:00.000Z" } as any);
    await controller.listPolicies();
    await controller.createPolicy({ name: "Standard" } as any);
    await controller.updatePolicy("policy-id", { name: "Updated" } as any);

    expect(service.report).toHaveBeenCalledWith({
      from: "2026-03-01T00:00:00.000Z",
    });
    expect(service.listPolicies).toHaveBeenCalled();
    expect(service.createPolicy).toHaveBeenCalledWith({ name: "Standard" });
    expect(service.updatePolicy).toHaveBeenCalledWith("policy-id", {
      name: "Updated",
    });
  });

  it("declares exact permission metadata and the §9 route surface", () => {
    const expected: Record<string, string> = {
      reports: "read",
      listPolicies: "read",
      createPolicy: "update",
      updatePolicy: "update",
    };
    for (const [method, action] of Object.entries(expected)) {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          (SlaController.prototype as any)[method],
        ),
      ).toEqual([{ resource: "crm", action }]);
    }

    expect(Reflect.getMetadata(PATH_METADATA, SlaController)).toBe("v1/sla");
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        (SlaController.prototype as any).reports,
      ),
    ).toBe("reports");
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        (SlaController.prototype as any).listPolicies,
      ),
    ).toBe("policies");
    // RequestMethod.POST === 1 — policy creation writes.
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        (SlaController.prototype as any).createPolicy,
      ),
    ).toBe(1);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        (SlaController.prototype as any).updatePolicy,
      ),
    ).toBe("policies/:id");
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        (SlaController.prototype as any).updatePolicy,
      ),
    ).toBe(4);
  });
});
