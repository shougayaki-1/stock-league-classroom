/**
 * PROVISIONAL tuning constants — single-source index (Task 19, Phase C
 * completion condition 5).
 *
 * Every value re-exported here is a placeholder chosen during Phase C
 * implementation because the integrated spec (統合仕様書) and its
 * resolution doc leave no fixed numeric default for it — each site is
 * individually documented as PROVISIONAL at its point of definition. This
 * file does not redefine any of them; it only re-exports the existing
 * single-source constants so a playtesting/teacher-facing "詳細設定"
 * pass has one place to look before touching any of them.
 *
 * Do NOT hardcode a second copy of these values anywhere else in the
 * codebase — always import from the original module (or from here).
 *
 * | Constant | Defined in | Meaning |
 * | --- | --- | --- |
 * | `PRICE_SENSITIVITY_PRESETS` | engine/priceCalculation.ts | Relative weight of the information term vs. the demand term per preset (spec: "需給感度の既定値" unresolved). |
 * | `DEFAULT_NOISE_MAGNITUDE_PERCENT` | engine/priceCalculation.ts | Market noise magnitude applied per batch (spec §12.22 gives only a qualitative ±0.2〜0.5% guideline). |
 * | `DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT` | engine/priceCalculation.ts | Threshold, as a percent price move, above which a "急変" (sudden change) warning fires (spec §12.24, no numeric default given). |
 * | `SHORT_TERM_WINDOW_BATCHES` | engine/informationImpact.ts | Number of batches after publication during which an information item's impact is in its "short-term" (larger) phase before decaying to long-term. |
 * | `FLAT_BAND_PERCENT` | predictionCheckpoint.ts | Band, as a percent price change, within which a resolved prediction is classified FLAT rather than UP/DOWN. |
 * | `STALL_DETECTION_THRESHOLD_MILLIS` | chainWatchdog.ts | How long the batch chain watchdog waits past `nextBatchAtMillis` before treating the chain as stalled and re-triggering it. |
 */

export { PRICE_SENSITIVITY_PRESETS, DEFAULT_NOISE_MAGNITUDE_PERCENT, DEFAULT_SUDDEN_CHANGE_WARNING_THRESHOLD_PERCENT } from './priceCalculation'
export { SHORT_TERM_WINDOW_BATCHES } from './informationImpact'
export { FLAT_BAND_PERCENT } from '../predictionCheckpoint'
export { STALL_DETECTION_THRESHOLD_MILLIS } from '../chainWatchdog'
