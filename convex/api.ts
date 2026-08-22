import { anyApi, type ApiFromModules } from "convex/server";
import type * as appUsers from "./appUsers";
import type * as attendance from "./attendance";
import type * as migrations from "./migrations";
import type * as participants from "./participants";
import type * as pikaIntegration from "./pikaIntegration";
import type * as pikaOutbox from "./pikaOutbox";
import type * as pikaOutboxModel from "./pikaOutboxModel";
import type * as pikaOutboxRecovery from "./pikaOutboxRecovery";
import type * as pikaRetention from "./pikaRetention";
import type * as pikaSmoke from "./pikaSmoke";
import type * as rosters from "./rosters";
import type * as sessions from "./sessions";

type AppApi = ApiFromModules<{
  appUsers: typeof appUsers;
  attendance: typeof attendance;
  participants: typeof participants;
  rosters: typeof rosters;
  sessions: typeof sessions;
}>;

export const api = anyApi as unknown as AppApi;

type AppInternalApi = ApiFromModules<{
  migrations: typeof migrations;
  pikaIntegration: typeof pikaIntegration;
  pikaOutboxModel: typeof pikaOutboxModel;
  pikaOutboxRecovery: typeof pikaOutboxRecovery;
  pikaRetention: typeof pikaRetention;
  pikaSmoke: typeof pikaSmoke;
}>;

export const internal = anyApi as unknown as AppInternalApi;

type AppInternalActions = ApiFromModules<{
  pikaOutbox: typeof pikaOutbox;
}>;

export const internalActions = anyApi as unknown as AppInternalActions;
