import { collection, getDocs, limit, orderBy, query, where, type Firestore, type QueryConstraint } from 'firebase/firestore'
import { MARKETPLACE_VISIBILITIES, type MarketplaceVisibility } from './marketplaceVisibility'

export interface CommunityTemplate {
  id: string
  title: string
  description: string
  subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
  currentPublishedVersionId: string
  visibility: MarketplaceVisibility
}

export interface ListCommunityTemplatesInput { subject?: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS' }

export const listCommunityTemplates = async (firestore: Firestore, input: ListCommunityTemplatesInput = {}): Promise<CommunityTemplate[]> => {
  const constraints: QueryConstraint[] = [where('visibility', 'in', MARKETPLACE_VISIBILITIES)]
  if (input.subject) constraints.push(where('subject', '==', input.subject))
  constraints.push(orderBy('publishedToCommunityAt', 'desc'), limit(50))

  const snapshot = await getDocs(query(collection(firestore, 'lessonTemplates'), ...constraints))
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as {
      title: string
      description: string
      subject: 'SOCIAL_STUDIES' | 'HOME_ECONOMICS'
      currentPublishedVersionId: string
      visibility: MarketplaceVisibility
    }
    return {
      id: docSnap.id,
      title: data.title,
      description: data.description,
      subject: data.subject,
      currentPublishedVersionId: data.currentPublishedVersionId,
      visibility: data.visibility,
    }
  })
}
