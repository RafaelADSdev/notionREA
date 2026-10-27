import { getTranslations } from "@/lib/i18n/server";
import "server-only";
import { z } from "zod";
import { planTemplateCopy } from "@/features/interchange/server/template-copy";
import { parsePropertyWrite, parseView, propertyDefinitionSchema } from "../model";
import { uuidSchema } from "../model/properties";
import type { DatabaseCommandResult } from "../types";
import { databaseClient } from "./client";
import { databaseMetadata } from "./queries";
import {
  checkDatabaseError,
  commandSchema,
  DatabaseRequestError,
  parseInput,
  parseServer,
  revisionSchema,
  toJson,
} from "./validation";

const createdSchema = z.strictObject({ id: uuidSchema, pageId: uuidSchema });
const resultSchema = z.strictObject({
  id: uuidSchema.optional(),
  revision: revisionSchema.optional(),
  requiresConfirmation: z.boolean().optional(),
  previewToken: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  incompatibleCount: revisionSchema.optional(),
  valueCount: revisionSchema.optional(),
  dependentViews: z.array(uuidSchema).optional(),
  deleted: z.boolean().optional(),
});
function mutationResult(input: unknown): DatabaseCommandResult & { deleted?: boolean } {
  const value = parseServer(() => resultSchema.parse(input));
  return {
    ok: true,
    ...(value.id !== undefined ? { id: value.id } : {}),
    ...(value.revision !== undefined ? { revision: value.revision } : {}),
    ...(value.requiresConfirmation !== undefined ? { requiresConfirmation: value.requiresConfirmation } : {}),
    ...(value.previewToken !== undefined ? { previewToken: value.previewToken } : {}),
    ...(value.incompatibleCount !== undefined ? { incompatibleCount: value.incompatibleCount } : {}),
    ...(value.valueCount !== undefined ? { valueCount: value.valueCount } : {}),
    ...(value.dependentViews !== undefined ? { dependentViews: value.dependentViews } : {}),
    ...(value.deleted !== undefined ? { deleted: value.deleted } : {}),
  };
}

export async function createDatabase(input: unknown) {
  const value = z
    .strictObject({
      workspaceId: uuidSchema,
      parentId: uuidSchema.nullable(),
      title: z.string().max(500),
      requestId: uuidSchema,
    })
    .parse(input);
  const client = await databaseClient();
  const result = await client.rpc("create_database", {
    p_workspace_id: value.workspaceId,
    p_parent_page_id: value.parentId,
    p_title: value.title,
    p_request_id: value.requestId,
  });
  checkDatabaseError(result.error);
  return parseServer(() => createdSchema.parse(result.data));
}

export async function commandDatabase(
  databaseId: string,
  input: unknown,
  actorId: string,
  operationId = crypto.randomUUID(),
): Promise<DatabaseCommandResult> {
  const t = await getTranslations();

  const id = uuidSchema.parse(databaseId);
  uuidSchema.parse(actorId);
  const requestId = uuidSchema.parse(operationId);
  const command = commandSchema.parse(input);
  const client = await databaseClient();
  const metadata = await databaseMetadata(client, id);
  if (metadata.role !== "owner" && metadata.role !== "editor") throw new DatabaseRequestError(403);
  switch (command.action) {
    case "cell": {
      const property = metadata.properties.find((property) => property.id === command.propertyId);
      if (!property) throw new DatabaseRequestError(400);
      const value = parseInput(() => parsePropertyWrite(property, command.value));
      const result = await client.rpc("put_database_cell", {
        p_database_id: id,
        p_page_id: command.recordId,
        p_property_id: property.id,
        p_value: toJson(value),
        p_expected_revision: command.expectedRevision,
      });
      // The title branch of this RPC delegates to update_page with page CAS, never a second title cell.
      checkDatabaseError(result.error);
      return { ok: true, revision: parseServer(() => revisionSchema.parse(result.data)) };
    }
    case "property": {
      const property = parseInput(() =>
        propertyDefinitionSchema.parse({
          id: command.id ?? crypto.randomUUID(),
          name: command.name,
          type: command.type,
          config: command.config,
        }),
      );
      const result = await client.rpc("put_database_property", {
        p_database_id: id,
        p_id: command.id,
        p_name: property.name,
        p_type: property.type,
        p_config: toJson(property.config),
        p_expected_revision: command.expectedRevision,
        ...(command.confirm !== undefined ? { p_confirm: command.confirm } : {}),
        ...(command.previewToken ? { p_preview_token: command.previewToken } : {}),
      });
      checkDatabaseError(result.error);
      return mutationResult(result.data);
    }
    case "deleteProperty": {
      const result = await client.rpc("delete_database_property", {
        p_database_id: id,
        p_property_id: command.id,
        p_expected_revision: command.expectedRevision,
        ...(command.confirm !== undefined ? { p_confirm: command.confirm } : {}),
        ...(command.previewToken ? { p_preview_token: command.previewToken } : {}),
      });
      checkDatabaseError(result.error);
      const { deleted, ...value } = mutationResult(result.data);
      return { ...value, requiresConfirmation: !deleted };
    }
    case "view": {
      const view = parseInput(() =>
        parseView(
          {
            id: command.id ?? crypto.randomUUID(),
            name: command.name,
            type: command.type,
            ...command.config,
          },
          metadata.properties,
        ),
      );
      const result = await client.rpc("put_database_view", {
        p_database_id: id,
        p_id: command.id,
        p_name: view.name,
        p_type: view.type,
        p_config: toJson({
          visibleProperties: view.visibleProperties,
          sorts: view.sorts,
          filter: view.filter,
          groupBy: view.groupBy,
          datePropertyId: view.datePropertyId,
        }),
        p_expected_revision: command.expectedRevision,
      });
      checkDatabaseError(result.error);
      return mutationResult(result.data);
    }
    case "deleteView": {
      const result = await client.rpc("delete_database_view", {
        p_database_id: id,
        p_view_id: command.id,
        p_expected_revision: command.expectedRevision,
      });
      checkDatabaseError(result.error);
      return { ok: true };
    }
    case "moveRecord": {
      const result = await client.rpc("move_database_record", {
        p_database_id: id,
        p_page_id: command.id,
        p_before_id: command.beforeId,
        p_expected_revision: command.expectedRevision,
      });
      checkDatabaseError(result.error);
      return { ok: true, revision: parseServer(() => revisionSchema.parse(result.data)) };
    }
    case "deleteTemplate": {
      const result = await client.rpc("delete_database_template", {
        p_database_id: id,
        p_template_id: command.id,
        p_expected_revision: command.expectedRevision,
      });
      checkDatabaseError(result.error);
      return { ok: true };
    }
    case "createRecord":
    case "template": {
      if (command.action === "template" && command.id !== null) {
        const existing = metadata.templates.find((template) => template.id === command.id);
        if (!existing || (command.pageId && existing.pageId !== command.pageId))
          throw new DatabaseRequestError(403);
        const result = await client.rpc("put_database_template", {
          p_database_id: id,
          p_id: existing.id,
          p_page_id: existing.pageId,
          p_title: command.title,
          p_expected_revision: command.expectedRevision,
        });
        checkDatabaseError(result.error);
        return { ...mutationResult(result.data), pageId: existing.pageId };
      }
      const source =
        command.action === "createRecord"
          ? command.templateId
            ? metadata.templates.find((template) => template.id === command.templateId)
            : undefined
          : command.pageId
            ? metadata.templates.find((template) => template.pageId === command.pageId)
            : undefined;
      if ((command.action === "createRecord" ? command.templateId : command.pageId) && !source)
        throw new DatabaseRequestError(403);
      const result = await client.rpc("add_database_record", {
        p_database_id: id,
        p_title: command.title,
        p_request_id: requestId,
        p_is_template: command.action === "template",
      });
      checkDatabaseError(result.error);
      const created = parseServer(() => createdSchema.parse(result.data));
      try {
        const copy = source
          ? await planTemplateCopy({
              databaseId: id,
              sourcePageId: source.pageId,
              targetPageId: created.pageId,
              actorId,
              operationId: requestId,
            })
          : null;
        if (command.action === "template") {
          const existing = await client
            .from("database_templates")
            .select("id,revision")
            .eq("database_id", id)
            .eq("page_id", created.pageId)
            .maybeSingle();
          checkDatabaseError(existing.error);
          if (existing.data)
            return {
              ok: copy ? copy.job.state === "complete" : true,
              id: existing.data.id,
              pageId: created.pageId,
              ...(copy ? { jobId: copy.jobId } : {}),
            };
          const saved = await client.rpc("put_database_template", {
            p_database_id: id,
            p_id: null,
            p_page_id: created.pageId,
            p_title: command.title,
            p_expected_revision: 0,
          });
          checkDatabaseError(saved.error);
          return {
            ...mutationResult(saved.data),
            ok: copy ? copy.job.state === "complete" : true,
            pageId: created.pageId,
            ...(copy ? { jobId: copy.jobId } : {}),
          };
        }
        return {
          ok: copy ? copy.job.state === "complete" : true,
          ...created,
          ...(copy ? { jobId: copy.jobId } : {}),
        };
      } catch {
        return {
          ok: false,
          ...created,
          error: t("database.templatePartialNotice"),
        };
      }
    }
  }
}
