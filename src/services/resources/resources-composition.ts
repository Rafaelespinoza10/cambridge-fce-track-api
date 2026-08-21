import { getDatabaseConnection } from '@lib/shared/database';
import { ResourcesService } from './resources.service';

interface ResourcesServices {
  resources: ResourcesService;
}

async function buildResourcesServices(): Promise<ResourcesServices> {
  const dataSource = await getDatabaseConnection();
  return { resources: new ResourcesService(dataSource) };
}

export { buildResourcesServices };
export type { ResourcesServices };
