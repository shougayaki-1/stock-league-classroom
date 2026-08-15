import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore'
import { MARKETPLACE_VISIBILITIES, type MarketplaceVisibility } from './marketplaceVisibility'
import type { CommunityTemplate } from './communityTemplates'

/** マーケットプレイス公開済み(COMMUNITY/VERIFIED/OFFICIAL)の派生教材のみを対象とする(非公開の複製先は他組織のプライバシーに配慮して表示しない)。 */
export const listTemplateDerivatives = async (firestore: Firestore, sourceTemplateId: string): Promise<CommunityTemplate[]> => {
  const snapshot = await getDocs(query(
    collection(firestore, 'lessonTemplates'),
    where('sourceTemplateId', '==', sourceTemplateId),
    where('visibility', 'in', MARKETPLACE_VISIBILITIES),
  ))
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
