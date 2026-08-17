// The HTTP surface. Convex Auth needs routes of its own -- the sign-in and
// token-refresh endpoints the browser posts to -- and they live on the same
// deployment as everything else, which is the entire point of using it instead
// of a hosted identity provider.
import { httpRouter } from "convex/server";

import { auth } from "./authProvider";

const http = httpRouter();

auth.addHttpRoutes(http);

export default http;
