import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { bootstrapFirebase } from '../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../lib/auth/roles'
import { TemplateSharePage } from './TemplateSharePage'
import { TemplateWorkspace } from './TemplateWorkspace'
import { AuthLoadingScreen } from './teacher/TeacherShell'

export const TemplateRoutes = ({ shareId }: { shareId?: string }) => {
  const services = bootstrapFirebase()
  const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [isOperator, setIsOperator] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  useEffect(() => onAuthStateChanged(services.auth, (next) => {
    setUser(next)
    setAuthReady(true)
    if (!next) return setIsOperator(false)
    void next.getIdTokenResult().then((token) => setIsOperator(token.claims.operator === true)).catch(() => setIsOperator(false))
  }), [services.auth])
  const ownerUid = user && isTeacherIdentity(user) ? user.uid : undefined
  if (!shareId && !authReady) return <AuthLoadingScreen />
  return shareId
    ? <TemplateSharePage shareId={shareId} db={services.firestore} ownerUid={ownerUid} />
    : <TemplateWorkspace db={services.firestore} ownerUid={ownerUid} isOperator={isOperator} />
}
