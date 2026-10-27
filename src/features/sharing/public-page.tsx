"use client";

import Image from "next/image";
import Link from "next/link";
import { createContext, type ReactNode, useContext } from "react";
import { contentToneSchema } from "@/features/editor/model/block-schema";
import { isSafeContentLink } from "@/features/editor/model/content-schema";
import { useTranslations } from "@/lib/i18n/client";
import { formatDate, formatDecimal, formatNumber } from "@/lib/i18n/format";
import {
  type PublicBlock,
  type PublicInline,
  type PublicPage,
  publicationToken,
  publicReference,
} from "./model";
import "./public.css";

const ReferencesContext = createContext<ReadonlyMap<string, { title: string; token: string }>>(new Map());
function Inline({ value }: { value: PublicInline }) {
  const t = useTranslations();
  const references = useContext(ReferencesContext);
  if (value.type === "unavailable") return <span>{t("sharing.contentUnavailable")}</span>;
  if (value.type === "hardBreak") return <br />;
  if (value.type === "pageMention") {
    const reference = "token" in value.attrs ? value.attrs : references.get(value.attrs.pageId);
    return reference ? (
      <Link href={`/s/${reference.token}`}>{reference.title || t("pages.untitled")}</Link>
    ) : (
      <span>{t("sharing.contentUnavailable")}</span>
    );
  }
  let node: ReactNode = value.text;
  for (const mark of value.marks ?? []) {
    if (mark.type === "bold") node = <strong>{node}</strong>;
    else if (mark.type === "italic") node = <em>{node}</em>;
    else if (mark.type === "underline") node = <u>{node}</u>;
    else if (mark.type === "strike") node = <s>{node}</s>;
    else if (mark.type === "code") node = <code>{node}</code>;
    else if (
      mark.type === "link" &&
      typeof mark.attrs?.href === "string" &&
      isSafeContentLink(mark.attrs.href)
    )
      node = (
        <a href={mark.attrs.href} target="_blank" rel="noopener noreferrer nofollow">
          {node}
        </a>
      );
    else if (mark.type === "textStyle") {
      const color = contentToneSchema.safeParse(mark.attrs?.color),
        background = contentToneSchema.safeParse(mark.attrs?.background);
      node = (
        <span
          {...(color.success ? { "data-content-color": color.data } : {})}
          {...(background.success ? { "data-content-background": background.data } : {})}
        >
          {node}
        </span>
      );
    }
  }
  return node;
}
function Text({ block }: { block: PublicBlock }) {
  const counts = new Map<string, number>();
  return (
    <>
      {block.content.content
        .flatMap((paragraph) => paragraph.content)
        .map((inline) => {
          const signature = JSON.stringify(inline);
          const occurrence = counts.get(signature) ?? 0;
          counts.set(signature, occurrence + 1);
          return <Inline key={`${block.id}:${signature}:${occurrence}`} value={inline} />;
        })}
    </>
  );
}
type TreeProps = {
  groups: ReadonlyMap<string | null, PublicBlock[]>;
  parentId: string | null;
  token: string;
  depth?: number;
};
function Tree({ groups, parentId, token, depth = 0 }: TreeProps) {
  const children = groups.get(parentId) ?? [];
  const runs: PublicBlock[][] = [];
  for (const block of children) {
    const previous = runs.at(-1);
    if (
      ["bulletListItem", "numberListItem", "task"].includes(block.type) &&
      previous?.[0]?.type === block.type
    )
      previous.push(block);
    else runs.push([block]);
  }
  return (
    <>
      {runs.map((run) => {
        const first = run[0];
        if (!first) return null;
        const render = (block: PublicBlock) => (
          <Block key={block.id} block={block} groups={groups} token={token} depth={depth} />
        );
        if (first.type === "numberListItem")
          return (
            <ol
              key={first.id}
              start={typeof first.attributes.start === "number" ? first.attributes.start : 1}
            >
              {run.map((block) => (
                <li key={block.id}>{render(block)}</li>
              ))}
            </ol>
          );
        if (["bulletListItem", "task"].includes(first.type))
          return (
            <ul key={first.id} className={first.type === "task" ? "public-tasks" : undefined}>
              {run.map((block) => (
                <li key={block.id}>{render(block)}</li>
              ))}
            </ul>
          );
        return render(first);
      })}
    </>
  );
}
function Block({
  block,
  groups,
  token,
  depth,
}: {
  block: PublicBlock;
  groups: TreeProps["groups"];
  token: string;
  depth: number;
}) {
  const t = useTranslations();

  const nested = <Tree groups={groups} parentId={block.id} token={token} depth={depth + 1} />;
  const text = <Text block={block} />;
  if (block.type === "divider") return <hr />;
  if (block.type === "heading") {
    const heading =
      block.attributes.level === 3 ? (
        <h4>{text}</h4>
      ) : block.attributes.level === 2 ? (
        <h3>{text}</h3>
      ) : (
        <h2>{text}</h2>
      );
    return (
      <>
        {heading}
        {nested}
      </>
    );
  }
  if (block.type === "code")
    return (
      <pre>
        <code>{text}</code>
      </pre>
    );
  if (block.type === "quote")
    return (
      <blockquote>
        {text}
        {nested}
      </blockquote>
    );
  if (block.type === "toggle")
    return (
      <details>
        <summary>{text}</summary>
        {nested}
      </details>
    );
  if (block.type === "callout")
    return (
      <aside className="public-callout">
        {text}
        {nested}
      </aside>
    );
  if (block.type === "task")
    return (
      <>
        <span
          role="img"
          aria-label={block.attributes.checked === true ? t("sharing.taskDone") : t("sharing.taskPending")}
        >
          {block.attributes.checked === true ? "☑" : "☐"}
        </span>{" "}
        {text}
        {nested}
      </>
    );
  if (["bulletListItem", "numberListItem"].includes(block.type))
    return (
      <>
        {text}
        {nested}
      </>
    );
  if (block.type === "image" || block.type === "file") {
    const fileId = typeof block.attributes.fileId === "string" ? block.attributes.fileId : "";
    const href = `/api/public/${token}/files/${encodeURIComponent(fileId)}`;
    return (
      <figure>
        {fileId ? (
          block.type === "image" ? (
            <Image
              unoptimized
              src={href}
              width={1200}
              height={800}
              alt={typeof block.attributes.alt === "string" ? block.attributes.alt : ""}
            />
          ) : (
            <a href={href}>
              {typeof block.attributes.displayName === "string"
                ? block.attributes.displayName
                : t("sharing.downloadFile")}
            </a>
          )
        ) : (
          <p>{t("files.unavailable")}</p>
        )}
        {typeof block.attributes.caption === "string" && <figcaption>{block.attributes.caption}</figcaption>}
      </figure>
    );
  }
  if (block.type === "databaseRef") {
    const linked = publicationToken.safeParse(block.attributes.token);
    return linked.success ? (
      <p>
        <Link href={`/s/${linked.data}`}>{t("sharing.openDatabase")}</Link>
      </p>
    ) : (
      <p>{t("sharing.databaseUnavailable")}</p>
    );
  }
  if (block.type === "table")
    return (
      <div className="public-table-scroll">
        <table>
          <tbody>
            {(groups.get(block.id) ?? []).map((row) => (
              <tr key={row.id}>
                {(groups.get(row.id) ?? []).map((cell) =>
                  block.attributes.header === true && row.id === groups.get(block.id)?.[0]?.id ? (
                    <th key={cell.id} scope="col">
                      <Text block={cell} />
                      <Tree groups={groups} parentId={cell.id} token={token} depth={depth + 1} />
                    </th>
                  ) : (
                    <td key={cell.id}>
                      <Text block={cell} />
                      <Tree groups={groups} parentId={cell.id} token={token} depth={depth + 1} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (block.type === "columns")
    return (
      <div
        className="public-columns"
        style={{
          gridTemplateColumns: `repeat(${Math.min(12, Math.max(2, groups.get(block.id)?.length ?? 2))}, minmax(0, 1fr))`,
        }}
      >
        {nested}
      </div>
    );
  if (block.type === "column") return <section>{nested}</section>;
  if (block.type === "tableRow" || block.type === "tableCell")
    return (
      <>
        {text}
        {nested}
      </>
    );
  return (
    <>
      <p>{text}</p>
      {nested}
    </>
  );
}
function Value({
  value,
  options,
  type,
}: {
  value: unknown;
  options?: { id: string; label: string }[];
  type?: string;
}) {
  const t = useTranslations();

  if (value === null || value === undefined) return <span>—</span>;
  if (typeof value === "boolean") return <span>{value ? t("common.yes") : t("common.no")}</span>;
  if (typeof value === "string" && type === "number") return <span>{formatDecimal(value, t.locale)}</span>;
  if (
    typeof value === "string" &&
    (type === "createdTime" || type === "editedTime") &&
    !Number.isNaN(Date.parse(value))
  )
    return <span>{formatDate(value, t.locale, { dateStyle: "short", timeStyle: "short" })}</span>;
  if (typeof value === "string")
    return <span>{options?.find((option) => option.id === value)?.label ?? value}</span>;
  if (typeof value === "number") return <span>{formatNumber(value, t.locale)}</span>;
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return (
      <span>
        {value
          .map((item) =>
            type === "person"
              ? t("common.member")
              : (options?.find((option) => option.id === item)?.label ?? item),
          )
          .join(", ")}
      </span>
    );
  if (Array.isArray(value))
    return (
      <>
        {value.map((item) => {
          const reference = publicReference.safeParse(item);
          return reference.success ? (
            <span className="public-reference" key={reference.data.id}>
              <Value value={reference.data} />
            </span>
          ) : null;
        })}
      </>
    );
  const reference = publicReference.safeParse(value);
  if (reference.success)
    return <Link href={`/s/${reference.data.token}`}>{reference.data.title || t("pages.untitled")}</Link>;
  if (typeof value === "object" && "start" in value && typeof value.start === "string")
    return (
      <span>
        {!Number.isNaN(Date.parse(value.start)) ? formatDate(value.start, t.locale) : value.start}
        {"end" in value && typeof value.end === "string"
          ? ` — ${!Number.isNaN(Date.parse(value.end)) ? formatDate(value.end, t.locale) : value.end}`
          : ""}
      </span>
    );
  return <span>{t("sharing.contentUnavailable")}</span>;
}
export function PublicPageDocument({ data, token }: { data: PublicPage; token: string }) {
  const t = useTranslations();

  const groups = new Map<string | null, PublicBlock[]>();
  for (const block of data.content.blocks) {
    const siblings = groups.get(block.parentId) ?? [];
    siblings.push(block);
    groups.set(block.parentId, siblings);
  }
  return (
    <main className="public-page">
      <header>
        <Link href="/">{t("sharing.brandHeading")}</Link>
        <span>{t("sharing.readonlyPage")}</span>
      </header>
      <article>
        {data.page.coverFileId && (
          <Image
            unoptimized
            className="public-cover"
            src={`/api/public/${token}/files/${data.page.coverFileId}`}
            width={1400}
            height={440}
            alt=""
          />
        )}
        <h1>
          {data.page.icon && <span aria-hidden="true">{data.page.icon} </span>}
          {data.page.title || t("pages.untitled")}
        </h1>
        <ReferencesContext
          value={new Map((data.content.references ?? []).map((reference) => [reference.id, reference]))}
        >
          <Tree groups={groups} parentId={null} token={token} />
        </ReferencesContext>
        {data.database && (
          <section aria-label={t("sharing.publishedDatabase")}>
            <div className="public-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t("sharing.record")}</th>
                    {data.database.properties.map((property) => (
                      <th scope="col" key={property.id}>
                        {property.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.database.rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">
                        <Link href={`/s/${row.token}`}>{row.title || t("database.untitledRecord")}</Link>
                      </th>
                      {data.database?.properties.map((property) => (
                        <td key={property.id}>
                          <Value
                            value={row.values[property.id]}
                            type={property.type}
                            {...(property.options ? { options: property.options } : {})}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.database.rows.length && <p>{t("sharing.noRecords")}</p>}
            {data.database.nextCursor && (
              <Link href={`/s/${token}?after=${data.database.nextCursor}`}>{t("sharing.nextRecords")}</Link>
            )}
          </section>
        )}
      </article>
      <footer>{t("sharing.publicNotice")}</footer>
    </main>
  );
}
