import { httpsCallable, type Functions } from 'firebase/functions'

export interface OrgStudentDataExport {
  exportedAt: string
  orgId: string
  lessonRuns: Array<Record<string, unknown>>
}

export interface ExportOrgStudentDataInput { orgId: string }

export const exportOrgStudentData = async (functions: Functions, input: ExportOrgStudentDataInput): Promise<OrgStudentDataExport> =>
  (await httpsCallable<ExportOrgStudentDataInput, OrgStudentDataExport>(functions, 'exportOrgStudentDataCallable')(input)).data

export const downloadAsJsonFile = (data: unknown, filename: string): void => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
