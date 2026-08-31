# 求人応募フォーム入力補助（汎用ATS・公開版）

Tampermonkey向けの求人応募フォーム入力支援UserScriptです。HRMOSを中心に、複数のATSでフォーム項目を意味ベースに判定し、利用者が登録したプロフィールを入力します。

> Public/privacy-safe edition: this repository contains **no bundled personal profile data**.

## 特徴

- 氏名、連絡先、住所、生年月日などの基本情報
- 学歴・職歴・資格の複数登録
- 学歴・職歴・資格・企業独自回答のドラッグ / ↑↓ 並べ替え
- 複数プロフィールの作成・複製・切替・削除
- select / プルダウン、radio、checkbox、複数選択への対応
- `role="radio"` / `role="checkbox"` / `role="switch"` / `role="option"` などのカスタムUI対応
- 企業独自質問をGUIから追加
- プロフィール設定画面のリサイズ・最小化・最大化
- 入力支援パネルの移動・最小化・リサイズ・位置記憶
- ファイル添付、同意、CAPTCHA、最終送信は自動化しない設計

## 対応先

現時点でUserScriptの対象に含めている主なATSです。

- HRMOS
- Greenhouse
- Lever
- Workable
- Ashby
- HERP Hire
- Talentio
- SmartRecruiters
- Workday
- Jobvite
- Breezy HR
- Recruitee

企業独自のDOMやカスタムコンポーネントによっては部分対応になります。

## インストール

1. Tampermonkeyをブラウザへ導入します。
2. `job-application-autofill.user.js` をTampermonkeyへ登録します。
3. 対応する求人応募ページを開きます。
4. 画面上の「求人応募 入力支援」→「プロフィール設定」から自分の情報を登録します。
5. 内容を確認して「入力」を押します。

## プライバシー

公開版には氏名、住所、メールアドレス、電話番号、学歴、職歴、資格、自己PRなどの個人プロフィール値を一切同梱していません。

また、公開版は専用の保存キーを使用し、旧版・個人利用版の保存領域からプロフィールを自動移行しません。これにより、同じブラウザに個人利用版が存在していても、公開版が意図せず既存の個人情報を取り込まないようにしています。

プロフィールはTampermonkeyの `GM_setValue` / `GM_getValue` を利用してブラウザ側へ保存します。このUserScript自体には `fetch`、`XMLHttpRequest`、`GM_xmlhttpRequest` などの外部送信用APIは実装していません。

詳細は [PRIVACY.md](./PRIVACY.md) を参照してください。

## 安全上の仕様

以下は自動化しません。

- 応募の最終送信
- 個人情報保護方針への同意
- CAPTCHA / reCAPTCHA
- 履歴書・職務経歴書などのローカルファイル選択

入力後は必ず内容を確認してください。

## 開発・検証

公開化時に以下を確認しています。

- `node --check` によるJavaScript構文検証
- 既知の個人情報文字列・メールアドレス・電話番号形式の静的スキャン
- 公開版の初期プロフィールが空であること
- 旧版プロフィール保存キーから自動移行されないこと
- プロフィール設定画面が正常に起動すること

## ライセンス

現時点ではライセンスを明示していません。再配布・派生利用の条件を設定する場合は、リポジトリ公開時に適切なライセンスを追加してください。
