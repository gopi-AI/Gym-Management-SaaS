/**
 * Measurement API endpoints (P2-07).
 *
 * The Workouts progress-review UI REUSES these rows — it never creates a second
 * measurement source of truth.
 */

import { api } from './api';
import type { MeasurementLog, Paginated } from './types';

export interface ListMeasurementsParams {
  page?: number;
  limit?: number;
  measurement_type?: string;
  date_from?: string;
  date_to?: string;
}

export const measurementsApi = {
  list: (memberId: string, params: ListMeasurementsParams = {}) =>
    api.get<Paginated<MeasurementLog>>(
      `/v1/members/${memberId}/measurements`,
      {
        query: {
          page: params.page,
          limit: params.limit,
          measurement_type: params.measurement_type,
          date_from: params.date_from,
          date_to: params.date_to,
        },
      },
    ),
};
