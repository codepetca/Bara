/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as api_ from "../api.js";
import type * as appUsers from "../appUsers.js";
import type * as attendance from "../attendance.js";
import type * as attendanceEngine from "../attendanceEngine.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as domain from "../domain.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as model from "../model.js";
import type * as participantLinks from "../participantLinks.js";
import type * as participants from "../participants.js";
import type * as pikaHttp from "../pikaHttp.js";
import type * as pikaIdentity from "../pikaIdentity.js";
import type * as pikaIntegration from "../pikaIntegration.js";
import type * as pikaIntegrationEvents from "../pikaIntegrationEvents.js";
import type * as pikaIntegrationValidators from "../pikaIntegrationValidators.js";
import type * as pikaOutbox from "../pikaOutbox.js";
import type * as pikaOutboxModel from "../pikaOutboxModel.js";
import type * as pikaRetention from "../pikaRetention.js";
import type * as rosters from "../rosters.js";
import type * as server from "../server.js";
import type * as sessions from "../sessions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  api: typeof api_;
  appUsers: typeof appUsers;
  attendance: typeof attendance;
  attendanceEngine: typeof attendanceEngine;
  auth: typeof auth;
  crons: typeof crons;
  domain: typeof domain;
  http: typeof http;
  migrations: typeof migrations;
  model: typeof model;
  participantLinks: typeof participantLinks;
  participants: typeof participants;
  pikaHttp: typeof pikaHttp;
  pikaIdentity: typeof pikaIdentity;
  pikaIntegration: typeof pikaIntegration;
  pikaIntegrationEvents: typeof pikaIntegrationEvents;
  pikaIntegrationValidators: typeof pikaIntegrationValidators;
  pikaOutbox: typeof pikaOutbox;
  pikaOutboxModel: typeof pikaOutboxModel;
  pikaRetention: typeof pikaRetention;
  rosters: typeof rosters;
  server: typeof server;
  sessions: typeof sessions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: {
    lib: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { name: string },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
      cancelAll: FunctionReference<
        "mutation",
        "internal",
        { sinceTs?: number },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { limit?: number; names?: Array<string> },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      migrate: FunctionReference<
        "mutation",
        "internal",
        {
          batchSize?: number;
          cursor?: string | null;
          dryRun: boolean;
          fnHandle: string;
          name: string;
          next?: Array<{ fnHandle: string; name: string }>;
          oneBatchOnly?: boolean;
          reset?: boolean;
        },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
    };
  };
};
