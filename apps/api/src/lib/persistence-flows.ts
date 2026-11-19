import { Prisma } from '@prisma/client';
import { FlowDto, FlowEdge, FlowNode, FlowVersionDto } from '@bothub/shared';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
}

function isDbEnabled(): boolean {
  return (
    !isTestRuntime() &&
    typeof process.env.DATABASE_URL === 'string' &&
    process.env.DATABASE_URL.trim().length > 0
  );
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface HydratableDbFlowRecord {
  id: string;
  organizationId: string | null;
  botId: string | null;
  name: string;
  description: string | null;
  isMainMenu: boolean;
  draftNodes: unknown;
  draftEdges: unknown;
  publishedNodes: unknown;
  publishedEdges: unknown;
  publishedVersion: number;
  createdAt: Date;
  updatedAt: Date;
  versions: Array<{
    id: string;
    versionNumber: number;
    nodes: unknown;
    edges: unknown;
    createdAt: Date;
  }>;
}

export function mapDbFlowRecordToDto(
  dbFlow: HydratableDbFlowRecord,
  fallbackOrganizationId: string,
  botName: string | null
): FlowDto {
  const draftVersion: FlowVersionDto = {
    id: `fv-${dbFlow.id}-draft`,
    versionNumber: Math.max(dbFlow.publishedVersion, 1),
    status: 'DRAFT',
    nodes: (dbFlow.draftNodes as FlowNode[]) ?? [],
    edges: (dbFlow.draftEdges as FlowEdge[]) ?? [],
    publishedAt: null,
    createdAt: dbFlow.updatedAt.toISOString()
  };

  const publishedVersion: FlowVersionDto | null =
    dbFlow.publishedNodes && dbFlow.publishedEdges
      ? {
          id: `fv-${dbFlow.id}-pub`,
          versionNumber: Math.max(dbFlow.publishedVersion, 1),
          status: 'PUBLISHED',
          nodes: dbFlow.publishedNodes as FlowNode[],
          edges: dbFlow.publishedEdges as FlowEdge[],
          publishedAt: dbFlow.updatedAt.toISOString(),
          createdAt: dbFlow.updatedAt.toISOString()
        }
      : null;

  const versions: FlowVersionDto[] = dbFlow.versions.map((ver) => ({
    id: ver.id,
    versionNumber: ver.versionNumber,
    status: ver.versionNumber === dbFlow.publishedVersion ? 'PUBLISHED' : 'DRAFT',
    nodes: (ver.nodes as FlowNode[]) ?? [],
    edges: (ver.edges as FlowEdge[]) ?? [],
    publishedAt:
      ver.versionNumber === dbFlow.publishedVersion
        ? ver.createdAt.toISOString()
        : null,
    createdAt: ver.createdAt.toISOString()
  }));

  return {
    id: dbFlow.id,
    organizationId: dbFlow.organizationId ?? fallbackOrganizationId,
    name: dbFlow.name,
    description: dbFlow.description ?? '',
    botId: dbFlow.botId,
    botName,
    isMainMenu: dbFlow.isMainMenu,
    activeVersionNumber: Math.max(dbFlow.publishedVersion, 1),
    draftVersion,
    publishedVersion,
    versions: versions.length > 0 ? versions : [draftVersion],
    createdAt: dbFlow.createdAt.toISOString(),
    updatedAt: dbFlow.updatedAt.toISOString()
  };
}

export async function hydrateStandaloneFlowsFromDb(): Promise<FlowDto[]> {
  if (!isDbEnabled()) return [];
  const standaloneFlows = await prisma.flow.findMany({
    where: {
      botId: null,
      organizationId: { not: null }
    },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 25
      }
    }
  });
  return standaloneFlows
    .filter((f): f is typeof f & { organizationId: string } => Boolean(f.organizationId))
    .map((f) => mapDbFlowRecordToDto(f, f.organizationId, null));
}

export async function syncFlowToDb(flow: FlowDto): Promise<void> {
  if (!isDbEnabled()) return;
  try {
    const orgExists = await prisma.organization.findUnique({
      where: { id: flow.organizationId },
      select: { id: true }
    });
    if (!orgExists) return;

    let validatedBotId: string | null = null;
    if (flow.botId) {
      const botExists = await prisma.bot.findFirst({
        where: { id: flow.botId, organizationId: flow.organizationId },
        select: { id: true }
      });
      if (!botExists) return;
      validatedBotId = botExists.id;
    }

    await prisma.flow.upsert({
      where: { id: flow.id },
      update: {
        organizationId: flow.organizationId,
        botId: validatedBotId,
        name: flow.name,
        description: flow.description,
        isMainMenu: flow.isMainMenu,
        draftNodes: toJsonInput(flow.draftVersion.nodes),
        draftEdges: toJsonInput(flow.draftVersion.edges),
        publishedNodes: flow.publishedVersion
          ? toJsonInput(flow.publishedVersion.nodes)
          : Prisma.JsonNull,
        publishedEdges: flow.publishedVersion
          ? toJsonInput(flow.publishedVersion.edges)
          : Prisma.JsonNull,
        publishedVersion: flow.publishedVersion ? flow.activeVersionNumber : 0
      },
      create: {
        id: flow.id,
        organizationId: flow.organizationId,
        botId: validatedBotId,
        name: flow.name,
        description: flow.description,
        isMainMenu: flow.isMainMenu,
        draftNodes: toJsonInput(flow.draftVersion.nodes),
        draftEdges: toJsonInput(flow.draftVersion.edges),
        publishedNodes: flow.publishedVersion
          ? toJsonInput(flow.publishedVersion.nodes)
          : Prisma.JsonNull,
        publishedEdges: flow.publishedVersion
          ? toJsonInput(flow.publishedVersion.edges)
          : Prisma.JsonNull,
        publishedVersion: flow.publishedVersion ? flow.activeVersionNumber : 0
      }
    });

    if (flow.publishedVersion) {
      await prisma.flowVersion.upsert({
        where: {
          flowId_versionNumber: {
            flowId: flow.id,
            versionNumber: flow.publishedVersion.versionNumber
          }
        },
        update: {
          nodes: toJsonInput(flow.publishedVersion.nodes),
          edges: toJsonInput(flow.publishedVersion.edges)
        },
        create: {
          flowId: flow.id,
          versionNumber: flow.publishedVersion.versionNumber,
          nodes: toJsonInput(flow.publishedVersion.nodes),
          edges: toJsonInput(flow.publishedVersion.edges)
        }
      });
    }
  } catch (err) {
    logger.warn({ flowId: flow.id, err }, 'Failed syncing flow to PostgreSQL');
  }
}

export async function deleteFlowFromDb(flowId: string): Promise<void> {
  if (!isDbEnabled()) return;
  try {
    await prisma.flow.deleteMany({ where: { id: flowId } });
  } catch (err) {
    logger.warn({ flowId, err }, 'Failed deleting flow from PostgreSQL');
  }
}
