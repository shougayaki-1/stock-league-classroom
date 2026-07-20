export const TemplateSharePage = ({ shareId }: { shareId: string }) => <main>
  <h1>共有テンプレート</h1>
  <p>この共有リンクを開くには、教師用メールリンクでログインしてください。</p>
  <p>ログイン後、このリンクのテンプレートを自分用に複製できます。</p>
  <code>{shareId}</code>
</main>
