// Built-in views: shipped with the client library, available to every host
// (the editor lists them as "builtin/<id>"; apps can pass them to mountView).

import type { DefinedView } from '../view-sdk'
import { levelMeterView } from './level-meter'
import { spectrogramView } from './spectrogram'

export { levelMeterView } from './level-meter'
export { spectrogramView } from './spectrogram'

export const builtinViews: DefinedView[] = [spectrogramView, levelMeterView]
