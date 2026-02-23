# Excelテンプレート配置場所

このディレクトリに日報出力用の Excel テンプレートを配置してください。

## 手順

1. ローカルPCの以下のパスからテンプレートファイルをコピー:
   ```
   C:\Users\sakurai\ﾌﾟﾛｼﾞｪｸﾄ\日報\
   ```

2. このディレクトリにファイル名 `daily_report_template.xlsx` として配置:
   ```
   templates/daily_report_template.xlsx
   ```

3. git add → commit → push でデプロイに反映されます

## 注意

- Vercel 上では Windows のローカルパスにアクセスできないため、
  テンプレートは必ずリポジトリに含める必要があります
- テンプレートを差し替える場合も同様に上書き → commit → push してください
