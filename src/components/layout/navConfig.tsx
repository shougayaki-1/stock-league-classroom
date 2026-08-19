import type { ComponentType } from 'react'
import { matchPath } from 'react-router'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined'
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined'
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined'
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined'
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined'

export interface NavItem {
  label: string
  path: string
  icon: ComponentType<{ fontSize?: 'small' | 'medium' | 'large' }>
}

export interface NavSection {
  label: string
  items: NavItem[]
}

/**
 * Static top-level destinations only — org-scoped pages (settings,
 * plan-limits, usage-dashboard, ...) require an :orgId the sidenav has no
 * way to know in advance, so they are reached by navigating from a page
 * that already has one (e.g. TeacherHomePage), not from this list.
 */
export const TEACHER_NAV_SECTIONS: NavSection[] = [
  {
    label: 'メイン',
    items: [
      { label: 'ホーム', path: '/teacher', icon: HomeOutlinedIcon },
      { label: '教材テンプレート', path: '/teacher/templates', icon: DescriptionOutlinedIcon },
      { label: 'マーケットプレイス', path: '/teacher/marketplace', icon: StorefrontOutlinedIcon },
    ],
  },
  {
    label: '運営者向け',
    items: [
      { label: 'パラメータ調整', path: '/teacher/tuning', icon: TuneOutlinedIcon },
      { label: '通報レポート', path: '/operator/reports', icon: FlagOutlinedIcon },
      { label: '教材認定', path: '/operator/certifications', icon: VerifiedOutlinedIcon },
      { label: 'AIベータ管理', path: '/operator/ai-beta', icon: ScienceOutlinedIcon },
    ],
  },
]

/** Every route rendered inside TeacherShell/StudentShell, mapped to a Japanese page title for the header. */
const PAGE_TITLES: Array<{ path: string; title: string }> = [
  { path: '/teacher', title: 'ホーム' },
  { path: '/teacher/templates', title: '教材テンプレート' },
  { path: '/teacher/templates/new', title: '新しい教材を作成' },
  { path: '/teacher/templates/:templateId/edit', title: '教材を編集' },
  { path: '/teacher/marketplace', title: 'マーケットプレイス' },
  { path: '/teacher/marketplace/:templateId', title: '教材の詳細' },
  { path: '/teacher/lessons/:runId/control', title: '授業コントロール' },
  { path: '/teacher/lessons/:runId/analytics', title: '授業の分析' },
  { path: '/teacher/organizations/new', title: '学校組織を作成' },
  { path: '/teacher/organizations/new-parent', title: '上位組織を作成' },
  { path: '/teacher/organizations/:orgId/settings', title: '組織設定' },
  { path: '/teacher/organizations/:orgId/plan-limits', title: 'プランと利用上限' },
  { path: '/teacher/organizations/:orgId/usage-dashboard', title: '利用状況ダッシュボード' },
  { path: '/teacher/organizations/:orgId/template-approvals', title: '教材承認' },
  { path: '/teacher/organizations/:orgId/parent-settings', title: '上位組織設定' },
  { path: '/teacher/tuning', title: 'パラメータ調整' },
  { path: '/operator/reports', title: '通報レポート' },
  { path: '/operator/certifications', title: '教材認定' },
  { path: '/operator/ai-beta', title: 'AIベータ管理' },
]

export function getPageTitle(pathname: string): string {
  const match = PAGE_TITLES.find((entry) => matchPath({ path: entry.path, end: true }, pathname))
  return match?.title ?? 'Stock League Classroom'
}

const STUDENT_STEP_TITLES: Array<{ path: string; title: string }> = [
  { path: '/join', title: '授業に参加' },
  { path: '/lessons/:runId/waiting', title: '待機中' },
  { path: '/lessons/:runId/play', title: '授業に参加中' },
  { path: '/lessons/:runId/results', title: '結果発表' },
]

export function getStudentStepTitle(pathname: string): string {
  const match = STUDENT_STEP_TITLES.find((entry) => matchPath({ path: entry.path, end: true }, pathname))
  return match?.title ?? 'Stock League Classroom'
}
