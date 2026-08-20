import { Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined'
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined'
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined'
import type { ComponentType } from 'react'

interface OperatorLink {
  label: string
  description: string
  icon: ComponentType<{ fontSize?: 'small' | 'medium' | 'large' }>
  onClick: () => void
}

export interface OperatorHomePageProps {
  onNavigateToTuning: () => void
  onNavigateToReports: () => void
  onNavigateToCertifications: () => void
  onNavigateToAiBeta: () => void
}

export function OperatorHomePage({
  onNavigateToTuning,
  onNavigateToReports,
  onNavigateToCertifications,
  onNavigateToAiBeta,
}: OperatorHomePageProps) {
  const links: OperatorLink[] = [
    { label: 'パラメータ調整', description: '試運転用パラメータの一覧を確認する', icon: TuneOutlinedIcon, onClick: onNavigateToTuning },
    { label: '通報レポート', description: '公開教材への通報を審査する', icon: FlagOutlinedIcon, onClick: onNavigateToReports },
    { label: '教材認定', description: '公開教材の認定レベルを管理する', icon: VerifiedOutlinedIcon, onClick: onNavigateToCertifications },
    { label: 'AIベータ管理', description: 'AI Lesson Studioの限定ベータアクセスを管理する', icon: ScienceOutlinedIcon, onClick: onNavigateToAiBeta },
  ]

  return (
    <Stack spacing={2} sx={{ p: 2, maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h5">運営者ページ</Typography>
      <Typography color="text.secondary">運営者向けの機能はこのページからのみ利用できます。</Typography>
      <Stack spacing={1.5}>
        {links.map((link) => {
          const Icon = link.icon
          return (
            <Card key={link.label} variant="outlined">
              <CardActionArea onClick={link.onClick}>
                <CardContent>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    <Icon fontSize="medium" />
                    <Stack>
                      <Typography variant="h6" component="div">{link.label}</Typography>
                      <Typography variant="body2" color="text.secondary">{link.description}</Typography>
                    </Stack>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          )
        })}
      </Stack>
    </Stack>
  )
}
