"use client";

import { Accessibility, defaultPreset } from "@dnd-kit/dom";
import { DragDropProvider, type DragEndEvent, useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import Image from "next/image";
import { type ReactNode, useState } from "react";
import { useTranslations } from "@/lib/i18n/client";
import { formatDate } from "@/lib/i18n/format";
import type { DatabaseSort, DateValue } from "../model";
import type { DatabaseData, DatabaseProperty, DatabaseRow, SavedDatabaseView } from "../types";
import { DatabaseCell, type RunCommand } from "./database-value";
import { addCivilDays, calendarDay, displayValue, moveDateToDay, rowValue } from "./value-utils";

type Group = { id: string; label: string; rows: DatabaseRow[] };
type Props = {
  data: DatabaseData;
  view: SavedDatabaseView;
  sorts: DatabaseSort[];
  groupBy: string | null;
  month: string;
  run: RunCommand;
  onRefresh: () => Promise<void>;
  onOpen: (id: string) => void;
};
function plugins(t: import("@/lib/i18n/core").Translator) {
  return [
    ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility),
    {
      plugin: Accessibility,
      options: {
        screenReaderInstructions: {
          draggable: t("database.dragInstructions"),
        },
        announcements: {
          dragstart: () => t("database.dragSelected"),
          dragover: () => t("database.dragDestination"),
          dragend: (event: DragEndEvent) =>
            event.canceled ? t("common.moveCancelled") : t("database.moveRequested"),
        },
      },
    },
  ];
}
function groupRows(
  data: DatabaseData,
  property: DatabaseProperty | undefined,
  board: boolean,
  t: import("@/lib/i18n/core").Translator,
): Group[] {
  if (!property) return [{ id: "all", label: t("database.records"), rows: data.rows }];
  const groups = new Map<string, Group>();
  const add = (id: string, label: string) => {
    if (!groups.has(id)) groups.set(id, { id, label, rows: [] });
  };
  if (board && property.type === "select") {
    for (const option of property.config.options) add(option.id, option.label);
    add("empty", t("database.noValue"));
  } else if (board && property.type === "checkbox") {
    add("false", t("database.unchecked"));
    add("true", t("database.checked"));
  }
  for (const row of data.rows) {
    const value = rowValue(row, property);
    const keys = Array.isArray(value)
      ? value.length
        ? value
        : ["empty"]
      : [value === null || value === "" ? "empty" : String(value)];
    for (const id of keys) {
      add(
        id,
        id === "empty"
          ? t("database.noValue")
          : displayValue(property, Array.isArray(value) ? [id] : value, data, t),
      );
      groups.get(id)?.rows.push(row);
    }
  }
  return [...groups.values()];
}
function GalleryCover({ fileId }: { fileId: string | null }) {
  const t = useTranslations();

  const [failed, setFailed] = useState(false);
  return fileId && !failed ? (
    <Image
      unoptimized
      src={`/api/files/${encodeURIComponent(fileId)}`}
      width={480}
      height={240}
      alt=""
      className="db-gallery-cover"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="db-gallery-fallback">
      <span aria-hidden="true">▰</span>
      <span>{t("database.noCover")}</span>
    </div>
  );
}
function DropGroup({ group, children, disabled }: { group: Group; children: ReactNode; disabled: boolean }) {
  const { ref, isDropTarget } = useDroppable({
    id: `db-group:${group.id}`,
    data: { groupId: group.id },
    disabled,
  });
  return (
    <section ref={ref} className="db-board-group" data-drop-target={isDropTarget} aria-label={group.label}>
      <h3>
        {group.label} <span>({group.rows.length})</span>
      </h3>
      {children}
    </section>
  );
}
function DaySlot({ day, children, editable }: { day: string; children: ReactNode; editable: boolean }) {
  const t = useTranslations();
  const { ref, isDropTarget } = useDroppable({ id: `db-day:${day}`, data: { day }, disabled: !editable });
  return (
    <td
      ref={ref}
      className="db-calendar-day"
      data-drop-target={isDropTarget}
      aria-label={formatDate(day, t.locale, { dateStyle: "full" })}
    >
      <time dateTime={day}>{Number(day.slice(-2))}</time>
      {children}
    </td>
  );
}
type RowProps = Props & {
  row: DatabaseRow;
  index: number;
  group: Group;
  fields: DatabaseProperty[];
  format: "table" | "list" | "card";
  manual: boolean;
  onMove: (row: DatabaseRow, beforeId: string | null) => void;
  onGroup: (row: DatabaseRow, groupId: string) => void;
  groups: Group[];
  onDay: (row: DatabaseRow, day: string) => void;
};
function RecordPresentation(props: RowProps) {
  const t = useTranslations();

  const { data, view, row, group, index, format, fields, manual } = props;
  const canDrag = data.editable && (manual || view.type === "board" || view.type === "calendar");
  const { ref, handleRef, isDragSource } = useSortable({
    id: `db-row:${group.id}:${row.id}`,
    index,
    group: `db:${group.id}`,
    data: { rowId: row.id, groupId: group.id },
    disabled: !canDrag,
  });
  const [targetDay, setTargetDay] = useState("");
  const controls = data.editable ? (
    <div className="db-record-actions">
      <button
        ref={handleRef}
        type="button"
        disabled={!canDrag}
        className="db-drag-handle"
        aria-label={t("database.moveRecordName", {
          name: row.title || t("database.untitledRecordLowercase"),
        })}
      >
        {t("common.move")}
      </button>
      {manual && (
        <label className="db-reorder">
          {t("database.moveBefore")}
          <select
            aria-label={t("database.recordPositionName", {
              name: row.title || t("database.untitledRecordLowercase"),
            })}
            defaultValue="choose"
            onChange={(event) => {
              if (event.target.value !== "choose") props.onMove(row, event.target.value || null);
              event.target.value = "choose";
            }}
          >
            <option value="choose">{t("database.choosePosition")}</option>
            {data.rows
              .filter((item) => item.id !== row.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title || t("common.untitled")}
                </option>
              ))}
            <option value="">{t("database.endList")}</option>
          </select>
        </label>
      )}
      {view.type === "board" && (
        <label>
          {t("common.moveTo")}
          <select
            aria-label={t("database.recordGroupName", {
              name: row.title || t("database.untitledRecordLowercase"),
            })}
            value={group.id}
            onChange={(event) => props.onGroup(row, event.target.value)}
          >
            {props.groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {view.type === "calendar" && (
        <form
          className="db-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (targetDay) props.onDay(row, targetDay);
          }}
        >
          <label>
            {t("database.moveToDay")}
            <input
              aria-label={t("database.recordDayName", {
                name: row.title || t("database.untitledRecordLowercase"),
              })}
              type="date"
              required
              value={targetDay}
              onChange={(event) => setTargetDay(event.target.value)}
            />
          </label>
          <button type="submit">{t("database.moveDate")}</button>
        </form>
      )}
    </div>
  ) : null;
  const cells = fields.map((property) => (
    <DatabaseCell
      key={property.id}
      row={row}
      property={property}
      data={data}
      run={props.run}
      onRefresh={props.onRefresh}
      onOpen={props.onOpen}
    />
  ));
  if (format === "table")
    return (
      <tr ref={ref} data-dragging={isDragSource}>
        {cells.map((cell, at) => (
          <td key={fields[at]?.id}>{cell}</td>
        ))}
        {data.editable && <td>{controls}</td>}
      </tr>
    );
  const content = (
    <>
      {view.type === "gallery" && <GalleryCover key={row.coverFileId} fileId={row.coverFileId} />}
      <div className="db-record-fields">
        {cells.map((cell, at) => (
          <div key={fields[at]?.id} className="db-record-field">
            {fields[at]?.type !== "title" && <span className="db-field-label">{fields[at]?.name}</span>}
            {cell}
          </div>
        ))}
      </div>
      {controls}
    </>
  );
  return format === "list" ? (
    <li ref={ref} className="db-list-row" data-dragging={isDragSource}>
      {content}
    </li>
  ) : (
    <article
      ref={ref}
      className="db-card"
      data-dragging={isDragSource}
      aria-label={row.title || t("database.untitledRecord")}
    >
      {content}
    </article>
  );
}
export function DatabaseViews(props: Props) {
  const t = useTranslations();

  const { data, view, groupBy, month } = props;
  const [error, setError] = useState("");
  const grouping = data.properties.find((property) => property.id === groupBy);
  const groups = groupRows(data, grouping, view.type === "board", t);
  const manual = data.editable && props.sorts.length === 0;
  const title = data.properties.find((property) => property.type === "title");
  const visible = view.visibleProperties
    .map((id) => data.properties.find((property) => property.id === id))
    .filter((property): property is DatabaseProperty => !!property);
  const fields = title ? [title, ...visible.filter((property) => property.id !== title.id)] : visible;
  const accept = async (command: Parameters<RunCommand>[0]) => {
    setError("");
    try {
      const result = await props.run(command);
      if (!result.ok) setError(t("database.moveRejected"));
    } catch {
      setError(t("database.moveFailed"));
    }
  };
  const move = (row: DatabaseRow, beforeId: string | null) => {
    if (manual && row.id !== beforeId)
      void accept({ action: "moveRecord", id: row.id, beforeId, expectedRevision: row.revision });
  };
  const groupMove = (row: DatabaseRow, groupId: string) => {
    if (!grouping || !data.editable || !["select", "checkbox"].includes(grouping.type)) return;
    const value = grouping.type === "checkbox" ? groupId === "true" : groupId === "empty" ? null : groupId;
    void accept({
      action: "cell",
      recordId: row.id,
      propertyId: grouping.id,
      value,
      expectedRevision: row.cellRevisions[grouping.id] ?? 0,
    });
  };
  const dateProperty = data.properties.find(
    (property) => property.id === view.datePropertyId && property.type === "date",
  );
  const dayMove = (row: DatabaseRow, day: string) => {
    if (!dateProperty || !data.editable) return;
    const value = rowValue(row, dateProperty);
    try {
      const next =
        value && typeof value === "object" && !Array.isArray(value)
          ? moveDateToDay(value, day)
          : dateProperty.type === "date" && dateProperty.config.mode === "civil"
            ? { kind: "civil" as const, start: day, end: null }
            : null;
      if (!next) {
        setError(t("database.setTimeZoneFirst"));
        return;
      }
      void accept({
        action: "cell",
        recordId: row.id,
        propertyId: dateProperty.id,
        value: next,
        expectedRevision: row.cellRevisions[dateProperty.id] ?? 0,
      });
    } catch {
      setError(t("database.invalidDayTime"));
    }
  };
  const present = (
    row: DatabaseRow,
    index: number,
    group: Group,
    format: RowProps["format"],
    shown = fields,
  ) => (
    <RecordPresentation
      key={`${group.id}:${row.id}`}
      {...props}
      {...{ row, index, group, format, manual, groups }}
      fields={shown}
      onMove={move}
      onGroup={groupMove}
      onDay={dayMove}
    />
  );
  const finish = (event: DragEndEvent) => {
    if (event.canceled || !data.editable) return;
    const row = data.rows.find((item) => item.id === event.operation.source?.data.rowId);
    const target = event.operation.target?.data;
    if (!row || !target) return;
    if (view.type === "calendar" && typeof target.day === "string") dayMove(row, target.day);
    else if (
      view.type === "board" &&
      typeof target.groupId === "string" &&
      target.groupId !== event.operation.source?.data.groupId
    )
      groupMove(row, target.groupId);
    else if (typeof target.rowId === "string") move(row, target.rowId);
  };
  let content: ReactNode;
  if (view.type === "table")
    content = (
      <div className="db-table-wrap">
        <table className="db-table">
          <caption>{view.name}</caption>
          <thead>
            <tr>
              {fields.map((property) => (
                <th key={property.id} scope="col">
                  {property.name}
                </th>
              ))}
              {data.editable && <th scope="col">{t("database.position")}</th>}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.id} aria-label={group.label}>
              {groupBy && (
                <tr className="db-group-heading">
                  <th colSpan={fields.length + (data.editable ? 1 : 0)}>{group.label}</th>
                </tr>
              )}
              {group.rows.map((row, index) => present(row, index, group, "table"))}
            </tbody>
          ))}
        </table>
      </div>
    );
  else if (view.type === "board")
    content =
      grouping && ["select", "checkbox"].includes(grouping.type) ? (
        <div className="db-board">
          {groups.map((group) => (
            <DropGroup key={group.id} group={group} disabled={!data.editable}>
              {group.rows.map((row, index) => present(row, index, group, "card"))}
              {!group.rows.length && <p>{t("database.emptyGroup")}</p>}
            </DropGroup>
          ))}
        </div>
      ) : (
        <p>{t("database.chooseBoardProperty")}</p>
      );
  else if (view.type === "calendar") {
    const first = `${month}-01`;
    const start = new Date(`${first}T12:00:00Z`);
    const offset = (start.getUTCDay() + 6) % 7;
    const nextMonth = new Date(start);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const last = addCivilDays(nextMonth.toISOString().slice(0, 10), -1);
    const days = Math.ceil((offset + Number(last.slice(-2))) / 7) * 7;
    const slots = Array.from({ length: days }, (_, index) => addCivilDays(first, index - offset));
    const dated = new Map<string, DatabaseRow[]>();
    const undated: DatabaseRow[] = [];
    for (const row of data.rows) {
      const value = dateProperty ? rowValue(row, dateProperty) : null;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const begin = calendarDay(value);
        const end = value.end ? calendarDay({ ...value, start: value.end } as DateValue) : begin;
        if (begin <= last && end >= first) {
          const day = [begin, first].sort().at(-1) ?? first;
          dated.set(day, [...(dated.get(day) ?? []), row]);
        }
      } else undated.push(row);
    }
    const shown =
      dateProperty && !fields.some((property) => property.id === dateProperty.id)
        ? [...fields, dateProperty]
        : fields;
    content = (
      <div className="db-calendar">
        <p>{t("database.calendarNotice")}</p>
        <table>
          <caption>
            {view.name} · {formatDate(`${month}-01`, t.locale, { month: "long", year: "numeric" })}
          </caption>
          <thead>
            <tr>
              {[
                t("calendar.monday"),
                t("calendar.tuesday"),
                t("calendar.wednesday"),
                t("calendar.thursday"),
                t("calendar.friday"),
                t("calendar.saturday"),
                t("calendar.sunday"),
              ].map((day) => (
                <th key={day} scope="col">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: days / 7 }, (_, week) => (
              <tr key={slots[week * 7]}>
                {slots.slice(week * 7, week * 7 + 7).map((day) => (
                  <DaySlot key={day} day={day} editable={data.editable}>
                    {(dated.get(day) ?? []).map((row, index) =>
                      present(
                        row,
                        index,
                        {
                          id: day,
                          label: formatDate(day, t.locale, { dateStyle: "full" }),
                          rows: dated.get(day) ?? [],
                        },
                        "card",
                        shown,
                      ),
                    )}
                  </DaySlot>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <section className="db-undated">
          <h3>{t("database.undated")}</h3>
          {undated.length ? (
            undated.map((row, index) =>
              present(
                row,
                index,
                { id: "undated", label: t("database.undated"), rows: undated },
                "card",
                shown,
              ),
            )
          ) : (
            <p>{t("database.noUndated")}</p>
          )}
        </section>
      </div>
    );
  } else
    content = (
      <div className={view.type === "gallery" ? "db-gallery-groups" : "db-list-groups"}>
        {groups.map((group) => (
          <section key={group.id} aria-label={group.label}>
            {groupBy && <h3>{group.label}</h3>}
            {view.type === "list" ? (
              <ul className="db-list">
                {group.rows.map((row, index) => present(row, index, group, "list"))}
              </ul>
            ) : (
              <div className="db-gallery">
                {group.rows.map((row, index) => present(row, index, group, "card"))}
              </div>
            )}
          </section>
        ))}
      </div>
    );
  return (
    <div className="db-view-content">
      {props.sorts.length > 0 && data.editable && (
        <p className="db-order-note">{t("database.sortedNotice")}</p>
      )}
      {error && (
        <p role="alert">
          {error}
          <button
            type="button"
            onClick={() => void props.onRefresh().catch(() => setError(t("database.refreshFailed")))}
          >
            {t("common.refreshData")}
          </button>
        </p>
      )}
      <DragDropProvider plugins={plugins(t)} onDragEnd={finish}>
        {content}
      </DragDropProvider>
      {!data.rows.length && <p className="db-empty">{t("database.emptyQuery")}</p>}
    </div>
  );
}
