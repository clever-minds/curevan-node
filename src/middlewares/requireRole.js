/**
 * Role check. Use after authMiddleware:
 *   router.post("/add", authMiddleware, requireRole("admin.ecom"), handler)
 * `admin.super` always passes. With no arguments only admin.super passes.
 * Reads req.user.roles (array) and req.user.role (string) set from the JWT.
 */
function userRoles(user) {
  if (!user) return [];
  const list = Array.isArray(user.roles) ? [...user.roles] : [];
  if (typeof user.role === "string" && user.role) list.push(user.role);
  return list;
}

function hasRole(user, role) {
  return userRoles(user).includes(role);
}

function isAdmin(user) {
  return userRoles(user).some((r) => r.startsWith("admin."));
}

function requireRole(...allowed) {
  const middleware = (req, res, next) => {
    const roles = userRoles(req.user);
    if (roles.includes("admin.super") || allowed.some((r) => roles.includes(r))) {
      return next();
    }
    return res.status(403).json({ success: false, message: "Forbidden" });
  };
  middleware.allowedRoles = allowed; // used by docs/ROUTE_PERMISSIONS generation
  return middleware;
}

module.exports = { requireRole, hasRole, isAdmin };
