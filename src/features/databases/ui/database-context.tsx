"use client";
import { createContext } from "react";
import type { DatabaseReference } from "../types";

export type FindDatabaseReferences = (
  databaseId: string,
  query: string,
  cursor?: string | null,
) => Promise<{ items: DatabaseReference[]; nextCursor: string | null }>;
export const ReferenceSearchContext = createContext<FindDatabaseReferences | undefined>(undefined);
export type FindDatabasePeople = (
  cursor?: string | null,
) => Promise<{ items: DatabaseReference[]; nextCursor: string | null }>;
export const PeopleSearchContext = createContext<FindDatabasePeople | undefined>(undefined);
