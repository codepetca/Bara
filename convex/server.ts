import {
  type GenericMutationCtx,
  type GenericQueryCtx,
  mutationGeneric,
  queryGeneric,
  httpActionGeneric,
  internalActionGeneric,
  internalQueryGeneric,
  internalMutationGeneric,
  type ActionBuilder,
  type MutationBuilder,
  type QueryBuilder,
} from "convex/server";
import type { DataModel } from "./model";

export const query = queryGeneric as QueryBuilder<DataModel, "public">;
export const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
export const internalMutation = internalMutationGeneric as MutationBuilder<DataModel, "internal">;
export const internalQuery = internalQueryGeneric as QueryBuilder<DataModel, "internal">;
export const internalAction = internalActionGeneric as ActionBuilder<DataModel, "internal">;
export const httpAction = httpActionGeneric;
export type QueryCtx = GenericQueryCtx<DataModel>;
export type MutationCtx = GenericMutationCtx<DataModel>;
