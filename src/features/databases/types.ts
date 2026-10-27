import type { DatabaseSort, DatabaseView, Filter, PropertyDefinition, PropertyValue } from "./model";

export type DatabaseProperty = PropertyDefinition & { revision: number; position: string };
export type SavedDatabaseView = DatabaseView & { revision: number; position: string };
export type DatabaseReference = { id: string; label: string; databaseId?: string };
export type DatabaseRow = {
  id: string;
  title: string;
  position: string;
  revision: number;
  values: Record<string, PropertyValue>;
  cellRevisions: Record<string, number>;
  createdAt: string;
  editedAt: string;
  coverFileId: string | null;
};
export type DatabaseTemplate = { id: string; pageId: string; title: string; revision: number };
export type DatabaseData = {
  id: string;
  workspaceId: string;
  pageId: string;
  title: string;
  revision: number;
  editable: boolean;
  properties: DatabaseProperty[];
  views: SavedDatabaseView[];
  templates: DatabaseTemplate[];
  viewId: string;
  rows: DatabaseRow[];
  nextCursor: string | null;
  people: DatabaseReference[];
  references: DatabaseReference[];
  databases: DatabaseReference[];
};
export type DatabaseQuery = {
  viewId?: string;
  cursor?: string | null;
  filter?: Filter | null;
  sorts?: DatabaseSort[];
  groupBy?: string | null;
  month?: string;
};
export type ViewConfiguration = Pick<
  DatabaseView,
  "visibleProperties" | "sorts" | "filter" | "groupBy" | "datePropertyId"
>;
export type DatabaseCommand =
  | { action: "createRecord"; title: string; templateId?: string }
  | { action: "cell"; recordId: string; propertyId: string; value: PropertyValue; expectedRevision: number }
  | {
      action: "property";
      id: string | null;
      name: string;
      type: PropertyDefinition["type"];
      config: PropertyDefinition["config"];
      expectedRevision: number;
      confirm?: boolean;
      previewToken?: string;
    }
  | {
      action: "deleteProperty";
      id: string;
      expectedRevision: number;
      confirm?: boolean;
      previewToken?: string;
    }
  | {
      action: "view";
      id: string | null;
      name: string;
      type: DatabaseView["type"];
      config: ViewConfiguration;
      expectedRevision: number;
    }
  | { action: "deleteView"; id: string; expectedRevision: number }
  | { action: "template"; id: string | null; title: string; pageId?: string; expectedRevision: number }
  | { action: "deleteTemplate"; id: string; expectedRevision: number }
  | { action: "moveRecord"; id: string; beforeId: string | null; expectedRevision: number };
export type DatabaseCommandResult = {
  ok: boolean;
  error?: string;
  id?: string;
  pageId?: string;
  revision?: number;
  jobId?: string;
  requiresConfirmation?: boolean;
  previewToken?: string;
  incompatibleCount?: number;
  valueCount?: number;
  dependentViews?: string[];
};
