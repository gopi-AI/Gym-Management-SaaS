'use client';

import React from 'react';
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import Table, { TBody, TBodyRow, Td, THead, THeadRow, Th } from '@/components/ui/Table';
import { ApiError, useMemberDietTab } from '@/lib';

const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  completed: 'secondary',
  expired: 'secondary',
};

interface DietTabProps {
  memberId: string;
  /** True while this tab is selected; the query only runs then (P2-09). */
  active: boolean;
}

/**
 * Diet tab — `GET /v1/members/:memberId/diet`.
 *
 * `dailyTotals` covers the backend's default window (the last 30 days); the
 * macro columns are null when no logged meal in that day carried macro data,
 * and `mealsMissingMacros` reports how many meals were excluded.
 */
export default function DietTab({ memberId, active }: DietTabProps) {
  const { data, isPending, isError, error } = useMemberDietTab(memberId, { enabled: active });

  if (isPending) {
    return <Empty title="Loading diet data…" description="Fetching plans, logs and totals." />;
  }

  if (isError) {
    return (
      <Alert type="danger">
        {error instanceof ApiError ? error.message : 'Failed to load diet data.'}
      </Alert>
    );
  }

  const dietPlans = data?.dietPlans ?? [];
  const nutritionLogs = data?.nutritionLogs ?? [];
  const dailyTotals = data?.dailyTotals ?? [];

  return (
    <>
      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Diet plans</CardTitle>
        </CardHeader>
        <CardBody>
          {dietPlans.length === 0 ? (
            <Empty title="No diet plans" description="This member has no assigned diet plans." />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Plan ID</Th>
                  <Th>Status</Th>
                  <Th>Start</Th>
                  <Th>End</Th>
                  <Th>Assigned by</Th>
                </THeadRow>
              </THead>
              <TBody>
                {dietPlans.map((plan) => (
                  <TBodyRow key={plan.id}>
                    <Td className="text-truncate" style={{ maxWidth: 120 }}>
                      {plan.diet_plan_id}
                    </Td>
                    <Td>
                      <Badge color={STATUS_COLOR[plan.status] ?? 'secondary'}>{plan.status}</Badge>
                    </Td>
                    <Td>{plan.start_date}</Td>
                    <Td>{plan.end_date ?? '—'}</Td>
                    <Td>{plan.assigned_by}</Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mb-3">
        <CardHeader>
          <CardTitle>Daily totals (last 30 days)</CardTitle>
        </CardHeader>
        <CardBody>
          {dailyTotals.length === 0 ? (
            <Empty
              title="No nutrition logged"
              description="No meals have been logged in the last 30 days."
            />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Date</Th>
                  <Th>Calories</Th>
                  <Th>Protein (g)</Th>
                  <Th>Carbs (g)</Th>
                  <Th>Fat (g)</Th>
                  <Th>Adherence</Th>
                  <Th>Meals missing macros</Th>
                </THeadRow>
              </THead>
              <TBody>
                {dailyTotals.map((total) => (
                  <TBodyRow key={total.log_date}>
                    <Td>{total.log_date}</Td>
                    <Td>{total.totalCalories ?? '—'}</Td>
                    <Td>{total.totalProteinG ?? '—'}</Td>
                    <Td>{total.totalCarbsG ?? '—'}</Td>
                    <Td>{total.totalFatG ?? '—'}</Td>
                    <Td>{total.adherencePct}%</Td>
                    <Td>
                      {total.mealsMissingMacros} of {total.totalMeals}
                    </Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nutrition logs</CardTitle>
        </CardHeader>
        <CardBody>
          {nutritionLogs.length === 0 ? (
            <Empty title="No meals logged" description="This member has no nutrition log entries." />
          ) : (
            <Table striped hover responsive cardTable nowrap>
              <THead>
                <THeadRow>
                  <Th>Date</Th>
                  <Th>Meal</Th>
                  <Th>Servings</Th>
                  <Th>Calories</Th>
                  <Th>Protein (g)</Th>
                  <Th>Carbs (g)</Th>
                  <Th>Fat (g)</Th>
                </THeadRow>
              </THead>
              <TBody>
                {nutritionLogs.map((log) => (
                  <TBodyRow key={log.id}>
                    <Td>{log.log_date}</Td>
                    <Td>
                      {log.meal_description ??
                        (log.meal_template_id ? 'Template meal' : '—')}
                    </Td>
                    <Td>{log.servings}</Td>
                    <Td>{log.calories ?? '—'}</Td>
                    <Td>{log.protein_g ?? '—'}</Td>
                    <Td>{log.carbs_g ?? '—'}</Td>
                    <Td>{log.fat_g ?? '—'}</Td>
                  </TBodyRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
