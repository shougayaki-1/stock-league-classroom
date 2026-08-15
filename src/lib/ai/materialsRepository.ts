import { addDoc, collection, getDocs, serverTimestamp, type Firestore } from 'firebase/firestore'
import { ref, uploadBytes, type FirebaseStorage } from 'firebase/storage'
import { extractTextFromFile } from './extractPdfText'
import { validateMaterialFile } from './materialLimits'

export interface MaterialDocument {
  id: string
  fileName: string
  text: string
  pageCount?: number
  storagePath?: string
}

/** Archives the raw file in Storage; only extracted text is persisted on the AI-readable Firestore path. */
export const uploadMaterial = async (
  storage: FirebaseStorage,
  firestore: Firestore,
  orgId: string,
  templateId: string,
  file: File
): Promise<MaterialDocument> => {
  const size = validateMaterialFile({ sizeBytes: file.size })
  if (!size.valid) throw new Error(size.error)
  const extracted = await extractTextFromFile(file)
  const full = validateMaterialFile({ sizeBytes: file.size, pageCount: extracted.pageCount })
  if (!full.valid) throw new Error(full.error)
  const storageId = crypto.randomUUID()
  const storagePath = `orgs/${orgId}/materials/${templateId}/${storageId}/${file.name}`
  await uploadBytes(ref(storage, storagePath), file)
  const record = await addDoc(collection(firestore, `lessonTemplates/${templateId}/materials`), {
    fileName: file.name,
    text: extracted.text,
    pageCount: extracted.pageCount ?? null,
    storagePath,
    createdAt: serverTimestamp(),
  })
  return { id: record.id, fileName: file.name, text: extracted.text, pageCount: extracted.pageCount, storagePath }
}

export const listMaterials = async (firestore: Firestore, templateId: string): Promise<MaterialDocument[]> => {
  const snapshot = await getDocs(collection(firestore, `lessonTemplates/${templateId}/materials`))
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as MaterialDocument)
}

