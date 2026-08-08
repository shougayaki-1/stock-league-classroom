import { useId, useState } from 'react'
import { Chip, Stack } from '@mui/material'
import { validateLessonInput } from '@stock-league/lesson-inputs'
import type { LessonInputConfig, LessonInputValue, LessonResponseScope } from '@stock-league/lesson-inputs'
import { AgreeDisagreeInput } from './AgreeDisagreeInput'
import { AllocationInput } from './AllocationInput'
import { MultipleChoiceInput } from './MultipleChoiceInput'
import { NumberInput } from './NumberInput'
import { QuantityInput } from './QuantityInput'
import { RankingInput } from './RankingInput'
import { ReasonChoiceInput } from './ReasonChoiceInput'
import { ShortTextInput } from './ShortTextInput'
import { SingleChoiceInput } from './SingleChoiceInput'

const DEFAULT_LABELS: Record<LessonInputConfig['type'], string> = {
  SINGLE_CHOICE: '選択してください',
  MULTIPLE_CHOICE: '当てはまるものを選んでください',
  NUMBER: '数値を入力してください',
  QUANTITY: '数量を入力してください',
  ALLOCATION: '配分を入力してください',
  RANKING: '順位をつけてください',
  AGREE_DISAGREE: '賛成・反対を選んでください',
  REASON_CHOICE: '選択と理由を入力してください',
  SHORT_TEXT: '回答を入力してください',
}

/**
 * 各 widget の config/value/onChange を1組の型として結びつける(distributive
 * conditional で LessonInputConfig の union を分配することで、SINGLE_CHOICE の
 * config には string の value しか渡せない、という対応関係を型で保つ)。
 */
export type LessonInputRendererProps<T extends LessonInputConfig = LessonInputConfig> = T extends LessonInputConfig
  ? {
      config: T
      value: LessonInputValue<T> | undefined
      onChange: (value: LessonInputValue<T>) => void
      /** 操作不能な理由。ボタン等は隠さず、隣接テキストとして表示する(§23.4)。 */
      disabledReason?: string
      /** 設問文。省略時は widget 種類に応じた汎用ラベルを表示する。 */
      label?: string
      id?: string
      /** チームで回答する設問であることを視覚的に示す(§23.6 の配慮)。 */
      responseScope?: LessonResponseScope
    }
  : never

/**
 * §10 共通入力コンポーネントのディスパッチャ。`config.type` に対応する
 * widget のみを描画し、他の widget の DOM は一切生成しない。
 */
export function LessonInputRenderer(props: LessonInputRendererProps) {
  const autoId = useId()
  const id = props.id ?? autoId
  const label = props.label ?? DEFAULT_LABELS[props.config.type]
  const [touched, setTouched] = useState(false)

  const teamBadge = props.responseScope === 'TEAM'
    ? <Chip label="チームの回答" size="small" variant="outlined" sx={{ alignSelf: 'flex-start', fontWeight: 700, borderWidth: 2 }} />
    : null

  switch (props.config.type) {
    case 'SINGLE_CHOICE': {
      const config = props.config
      const value = props.value as LessonInputValue<typeof config> | undefined
      const onChange = props.onChange as (value: LessonInputValue<typeof config>) => void
      const errors = touched ? validateLessonInput(config, value) : []
      return <Stack spacing={0.75}>
        {teamBadge}
        <SingleChoiceInput id={id} label={label} config={config} value={value} errors={errors} disabledReason={props.disabledReason}
          onChange={(v) => { setTouched(true); onChange(v) }} />
      </Stack>
    }
    case 'MULTIPLE_CHOICE': {
      const config = props.config
      const value = props.value as LessonInputValue<typeof config> | undefined
      const onChange = props.onChange as (value: LessonInputValue<typeof config>) => void
      const errors = touched ? validateLessonInput(config, value) : []
      return <Stack spacing={0.75}>
        {teamBadge}
        <MultipleChoiceInput id={id} label={label} config={config} value={value} errors={errors} disabledReason={props.disabledReason}
          onChange={(v) => { setTouched(true); onChange(v) }} />
      </Stack>
    }
    case 'NUMBER': {
      const config = props.config
      const value = props.value as LessonInputValue<typeof config> | undefined
      const onChange = props.onChange as (value: LessonInputValue<typeof config>) => void
      const errors = touched ? validateLessonInput(config, value) : []
      return <Stack spacing={0.75}>
        {teamBadge}
        <NumberInput id={id} label={label} config={config} value={value} errors={errors} disabledReason={props.disabledReason}
          onChange={(v) => { setTouched(true); onChange(v) }} />
      </Stack>
    }
    case 'QUANTITY': {
      const config = props.config
      const value = props.value as LessonInputValue<typeof config> | undefined
      const onChange = props.onChange as (value: LessonInputValue<typeof config>) => void
      const errors = touched ? validateLessonInput(config, value) : []
      return <Stack spacing={0.75}>
        {teamBadge}
        <QuantityInput id={id} label={label} config={config} value={value} errors={errors} disabledReason={props.disabledReason}
          onChange={(v) => { setTouched(true); onChange(v) }} />
      </Stack>
    }
    case 'ALLOCATION': {
      const config = props.config
      const value = props.value as LessonInputValue<typeof config> | undefined
      const onChange = props.onChange as (value: LessonInputValue<typeof config>) => void
      const errors = touched ? validateLessonInput(config, value) : []
      return <Stack spacing={0.75}>
        {teamBadge}
        <AllocationInput id={id} label={label} config={config} value={value} errors={errors} disabledReason={props.disabledReason}
          onChange={(v) => { setTouched(true); onChange(v) }} />
      </Stack>
    }
    case 'RANKING': {
      const config = props.config
      const value = props.value as LessonInputValue<typeof config> | undefined
      const onChange = props.onChange as (value: LessonInputValue<typeof config>) => void
      const errors = touched ? validateLessonInput(config, value) : []
      return <Stack spacing={0.75}>
        {teamBadge}
        <RankingInput id={id} label={label} config={config} value={value} errors={errors} disabledReason={props.disabledReason}
          onChange={(v) => { setTouched(true); onChange(v) }} />
      </Stack>
    }
    case 'AGREE_DISAGREE': {
      const config = props.config
      const value = props.value as LessonInputValue<typeof config> | undefined
      const onChange = props.onChange as (value: LessonInputValue<typeof config>) => void
      const errors = touched ? validateLessonInput(config, value) : []
      return <Stack spacing={0.75}>
        {teamBadge}
        <AgreeDisagreeInput id={id} label={label} config={config} value={value} errors={errors} disabledReason={props.disabledReason}
          onChange={(v) => { setTouched(true); onChange(v) }} />
      </Stack>
    }
    case 'REASON_CHOICE': {
      const config = props.config
      const value = props.value as LessonInputValue<typeof config> | undefined
      const onChange = props.onChange as (value: LessonInputValue<typeof config>) => void
      const errors = touched ? validateLessonInput(config, value) : []
      return <Stack spacing={0.75}>
        {teamBadge}
        <ReasonChoiceInput id={id} label={label} config={config} value={value} errors={errors} disabledReason={props.disabledReason}
          onChange={(v) => { setTouched(true); onChange(v) }} />
      </Stack>
    }
    case 'SHORT_TEXT': {
      const config = props.config
      const value = props.value as LessonInputValue<typeof config> | undefined
      const onChange = props.onChange as (value: LessonInputValue<typeof config>) => void
      const errors = touched ? validateLessonInput(config, value) : []
      return <Stack spacing={0.75}>
        {teamBadge}
        <ShortTextInput id={id} label={label} config={config} value={value} errors={errors} disabledReason={props.disabledReason}
          onChange={(v) => { setTouched(true); onChange(v) }} />
      </Stack>
    }
  }
}
