/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as balances from "../balances.js";
import type * as catalysts from "../catalysts.js";
import type * as crons from "../crons.js";
import type * as decisions from "../decisions.js";
import type * as flows from "../flows.js";
import type * as forecasts from "../forecasts.js";
import type * as netWorth from "../netWorth.js";
import type * as tenants from "../tenants.js";
import type * as validators from "../validators.js";
import type * as venues from "../venues.js";

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  audit: typeof audit;
  auth: typeof auth;
  balances: typeof balances;
  catalysts: typeof catalysts;
  crons: typeof crons;
  decisions: typeof decisions;
  flows: typeof flows;
  forecasts: typeof forecasts;
  netWorth: typeof netWorth;
  tenants: typeof tenants;
  validators: typeof validators;
  venues: typeof venues;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;

export declare const components: {};
