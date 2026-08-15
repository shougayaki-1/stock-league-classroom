import { collection, getDocs, limit, orderBy, query, where, type Firestore, type QueryConstraint } from 'firebase/firestore'

export interface CommunityTemplate {
  id: string
  title: string
  description: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  currentPublishedVersionId: string
}

export interface ListCommunityTemplatesInput { subject?: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' }

export const listCommunityTemplates = async (firestore: Firestore, input: ListCommunityTemplatesInput = {}): Promise<CommunityTemplate[]> => {
  const constraints: QueryConstraint[] = [where('visibility', '==', 'COMMUNITY')]
  if (input.subject) constraints.push(where('subject', '==', input.subject))
  constraints.push(orderBy('publishedToCommunityAt', 'desc'), limit(50))

  const snapshot = await getDocs(query(collection(firestore, 'lessonTemplates'), ...constraints))
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as { title: string; description: string; subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'; currentPublishedVersionId: string }
    return { id: docSnap.id, title: data.title, description: data.description, subject: data.subject, currentPublishedVersionId: data.currentPublishedVersionId }
  })
}
