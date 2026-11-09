# GL smokeが3回続けて成功したあとにmainを保護する

親が実Chromeで通常実行の成功と故障注入の非0終了を確認し、
実際のPRで `GL smoke` が3回続けて成功したことを確認してから設定します。
この変更には保護の有効化を含みません。

リポジトリ管理権限のあるアカウントで、GitHubのmain保護設定から
次の3検査を必須にし、「Require branches to be up to date before merging」を有効にします。

| 検査名 | 内容 |
|---|---|
| Node 22 | 既存の単体試験・静的検査・配信検査 |
| Node 24 | 同上 |
| GL smoke | 合成データによる描画と故障注入の確認 |

APIを使う場合は、既存の設定を先に読み、レビュー・管理者・制限の設定を保持します。
次は `jq` と `gh` が使える環境での手順です。実行場所はリポジトリ直下です。

```sh
mkdir -p .work/ci-protection
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh api "repos/$repo/branches/main/protection" > .work/ci-protection/before.json
jq '{
  required_status_checks: {strict: true, contexts: ["Node 22", "Node 24", "GL smoke"]},
  enforce_admins: .enforce_admins.enabled,
  required_pull_request_reviews: (if .required_pull_request_reviews then
    (.required_pull_request_reviews | del(.url)) else null end),
  restrictions: (if .restrictions then {
    users: [.restrictions.users[].login],
    teams: [.restrictions.teams[].slug],
    apps: [.restrictions.apps[].slug]
  } else null end),
  required_linear_history: .required_linear_history.enabled,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: (.block_creations.enabled // false),
  required_conversation_resolution: (.required_conversation_resolution.enabled // false),
  lock_branch: (.lock_branch.enabled // false),
  allow_fork_syncing: (.allow_fork_syncing.enabled // false)
}' .work/ci-protection/before.json > .work/ci-protection/proposed.json
cat .work/ci-protection/proposed.json
# 保持する設定を読み合わせたあと、親が実行する。
gh api -X PUT "repos/$repo/branches/main/protection" --input .work/ci-protection/proposed.json
```

既存の必須検査がほかにある場合は、削除せず提案JSONに加えてください。
rulesetも使っている場合は、その設定をGitHub画面で併せて確認します。

設定後は、CI失敗のPRとmainより古いPRがマージできないことを確認します。
GitHubでは競合するPRの `pull_request` 検査は走りません。
`feat/**` へのpush検査が走っても、競合が解けるまでマージはできません。
force pushと枝削除の禁止も引き続き確認します。
