import { anyApi, type ApiFromModules } from "convex/server";
import type * as appUsers from "./appUsers";
import type * as attendance from "./attendance";
import type * as migrations from "./migrations";
import type * as participants from "./participants";
import type * as pikaAutomation from "./pikaAutomation";
import type * as pikaIntegration from "./pikaIntegration";
import type * as pikaRooms from "./pikaRooms";
import type * as pikaParticipantErasure from "./pikaParticipantErasure";
import type * as pikaDecommission from "./pikaDecommission";
import type * as pikaOutbox from "./pikaOutbox";
import type * as pikaOutboxModel from "./pikaOutboxModel";
import type * as pikaOutboxRecovery from "./pikaOutboxRecovery";
import type * as pikaRetention from "./pikaRetention";
import type * as pikaSmoke from "./pikaSmoke";
import type * as pikaTenantRecovery from "./pikaTenantRecovery";
import type * as rooms from "./rooms";
import type * as rosters from "./rosters";
import type * as sessions from "./sessions";
import type * as workosMagicEmail from "./workosMagicEmail";
import type * as workosMagicEmailModel from "./workosMagicEmailModel";

type AppApi = ApiFromModules<{
  appUsers: typeof appUsers;
  attendance: typeof attendance;
  participants: typeof participants;
  rooms: typeof rooms;
  rosters: typeof rosters;
  sessions: typeof sessions;
}>;

export const api = anyApi as unknown as AppApi;

type AppInternalApi = ApiFromModules<{
  rooms: typeof rooms;
  migrations: typeof migrations;
  pikaIntegration: typeof pikaIntegration;
  pikaRooms: typeof pikaRooms;
  pikaDecommission: typeof pikaDecommission;
  pikaParticipantErasure: typeof pikaParticipantErasure;
  pikaOutboxModel: typeof pikaOutboxModel;
  pikaOutboxRecovery: typeof pikaOutboxRecovery;
  pikaRetention: typeof pikaRetention;
  pikaSmoke: typeof pikaSmoke;
  pikaTenantRecovery: typeof pikaTenantRecovery;
  workosMagicEmailModel: typeof workosMagicEmailModel;
}>;

export const internal = anyApi as unknown as AppInternalApi;

type AppInternalActions = ApiFromModules<{
  pikaAutomation: typeof pikaAutomation;
  pikaOutbox: typeof pikaOutbox;
  workosMagicEmail: typeof workosMagicEmail;
}>;

export const internalActions = anyApi as unknown as AppInternalActions;
