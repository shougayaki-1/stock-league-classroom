import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { bootstrapFirebase } from '../lib/firebase/bootstrap'
import { isTeacherIdentity } from '../lib/auth/roles'
import { TemplateSharePage } from './TemplateSharePage'
import { TemplateWorkspace } from './TemplateWorkspace'

export const TemplateRoutes = ({ shareId }: { shareId?: string }) => {
  const services = bootstrapFirebase()
  const [user, setUser] = useState<User | null>(services.auth.currentUser)
  const [isOperator, setIsOperator] = useState(false)
  useEffect(() => onAuthStateChanged(services.auth, async (next) => {
    setUser(next)
    setIsOperator(Boolean(next && (await next.getIdTokenResult()).claims.operator === true))
  }), [services.auth])
  const ownerUid = user && isTeacherIdentity(user) ? user.uid : undefined
  return shareId
    ? <TemplateSharePage shareId={shareId} db={services.firestore} ownerUid={ownerUid} />
    : <TemplateWorkspace db={services.firestore} ownerUid={ownerUid} isOperator={isOperator} />
}
