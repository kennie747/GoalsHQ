# GoalsHQ integration hooks

GoalsHQ is additive-only. Every file it adds lives in a new path and never
conflicts on an upstream merge. The **only** edits to files tududi also owns are
the small, append-style hunks below, all collected on the commit
`chore(goalshq): integration hooks`.

If an upstream merge conflicts on one of these, re-apply the hunk by hand — it is
always "add our line back next to where it was".

## 1. `backend/app.js` — 2 lines

```diff
 const templatesModule = require('./modules/templates');
 const reportsModule = require('./modules/reports');
+const goalshqModule = require('./modules/goalshq'); // goalshq integration hook
```

```diff
     app.use(basePath, templatesModule.routes);
     app.use(basePath, reportsModule.routes);
+    app.use(basePath, goalshqModule.routes); // goalshq integration hook
 };
```

There is **no** `startServer()` edit — the rollup scheduler self-initialises
lazily from the module's router on the first `/api/goalshq/*` request.

## 2. `frontend/App.tsx` — 2 lines

```diff
 const Tasks = lazy(() => import('./components/Tasks'));
+// goalshq integration hook
+const GoalsHqApp = lazy(() => import('./components/GoalsHQ/GoalsHqApp'));
```

```diff
+                            {/* goalshq integration hook */}
+                            <Route
+                                path="/goalshq/*"
+                                element={<GoalsHqApp />}
+                            />
                             <Route path="*" element={<NotFound />} />
                         </Route>
```

The route is a **wildcard** (`/goalshq/*`) — GoalsHQ can add any number of
internal pages without ever touching `App.tsx` again.

## 3. `frontend/components/Sidebar.tsx` — 2 lines

```diff
 import SidebarInsights from './Sidebar/SidebarInsights';
+import SidebarGoalsHQ from './Sidebar/SidebarGoalsHQ'; // goalshq integration hook
```

```diff
                         </div>
+                        {/* goalshq integration hook */}
+                        <div className="mb-[6px]">
+                            <SidebarGoalsHQ
+                                handleNavClick={handleNavClick}
+                                location={location}
+                            />
+                        </div>
                         <div className="mb-[6px]">
                             <SidebarAdmin
```

## 4. `public/locales/en/translation.json` — additive JSON block

A single `"goalshq": { … }` object added as the first key. Conflicts resolve by
keeping both the upstream change and the `goalshq` block. Other languages fall
back to English automatically (`frontend/i18n.ts`).

## What is deliberately NOT touched

- `backend/models/index.js` — GoalsHQ models self-register from
  `backend/modules/goalshq/models/` on the shared Sequelize instance; no
  associations to core models.
- `backend/modules/feature-flags/*`, `frontend/utils/featureFlags.ts` — the
  feature gate is the `GOALSHQ_ENABLED` env var, read in-module.
- `frontend/store/useStore.ts` — GoalsHQ has its own `useGoalsHqStore`.
- `frontend/config/paths.ts` — `getApiPath` takes any string, no whitelist.
- Any existing module, migration, component, serializer or route.
