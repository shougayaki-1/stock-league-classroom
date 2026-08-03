export const studentPrimaryActionSx = {
  minHeight: 52,
  borderRadius: 2.5,
  bgcolor: 'text.primary',
  color: 'background.paper',
  boxShadow: '0 8px 18px color-mix(in srgb, currentColor 14%, transparent)',
  '&:hover': { bgcolor: 'text.secondary', boxShadow: 'none' },
} as const

export const studentSurfaceSx = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 3,
  bgcolor: 'background.paper',
  boxShadow: '0 1px 3px color-mix(in srgb, currentColor 8%, transparent)',
} as const
