/** Stamped by vite.config.ts; the only version a non-engineer can read out loud. */
const commitSha = import.meta.env.VITE_COMMIT_SHA ?? 'unknown'

export const AppVersion = () => <small className="app-version">バージョン {commitSha}</small>
