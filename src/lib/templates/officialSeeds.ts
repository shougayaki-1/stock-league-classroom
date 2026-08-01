import type { TemplateSpec } from './types'

export const officialTemplateSeeds: Array<{ id: string; spec: TemplateSpec }> = [
  {
    id: 'school-festival',
    spec: { title: '学園祭マーケット', description: '来場者数と出店の評判で株価が動く、文化祭を題材にした入門市場。', startingCash: 10000, teams: [{ id: 'red', name: '赤チーム' }, { id: 'blue', name: '青チーム' }], companies: [
      { id: 'cafe', name: 'カフェ実行委員会', symbol: 'CAFE', initialPrice: 500 },
      { id: 'stage', name: 'ステージ企画', symbol: 'STGE', initialPrice: 400 },
      { id: 'games', name: 'ゲーム屋台', symbol: 'GAME', initialPrice: 350 },
    ] },
  },
  {
    id: 'space-colony',
    spec: { title: '宇宙都市マーケット', description: '資源開発・輸送・研究のニュースを読み、宇宙都市の成長に投資する市場。', startingCash: 12000, teams: [{ id: 'red', name: '赤チーム' }, { id: 'blue', name: '青チーム' }], companies: [
      { id: 'mining', name: 'ルナ資源開発', symbol: 'LUNA', initialPrice: 650 },
      { id: 'cargo', name: '軌道輸送', symbol: 'ORBT', initialPrice: 550 },
      { id: 'lab', name: '火星研究所', symbol: 'MARS', initialPrice: 450 },
    ] },
  },
  {
    id: 'local-revival',
    spec: { title: '地域再生マーケット', description: '観光・農業・交通の選択が地域経済を変える、社会科向けの協働市場。', startingCash: 10000, teams: [{ id: 'red', name: '赤チーム' }, { id: 'blue', name: '青チーム' }], companies: [
      { id: 'tourism', name: 'まち観光', symbol: 'TOUR', initialPrice: 500 },
      { id: 'farm', name: '地域農園', symbol: 'FARM', initialPrice: 450 },
      { id: 'rail', name: '地域交通', symbol: 'RAIL', initialPrice: 400 },
    ] },
  },
]
