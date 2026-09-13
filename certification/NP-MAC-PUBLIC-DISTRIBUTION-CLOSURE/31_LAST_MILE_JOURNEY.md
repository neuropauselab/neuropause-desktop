# Last-mile user journey — measured transitions

| Transition | Outcome | Evidence |
| --- | --- | --- |
| USER → DOWNLOAD PAGE | page exists (website/download.html); host HTTP 530 | 24/25 |
| DOWNLOAD MAC ARTIFACT | NOT_MEASURED (not published) | 25 |
| INSTALL | DMG mount + copy measured; ZIP extract measured | 12/13 |
| FIRST LAUNCH | READY in 4604 ms, local mode | 07 |
| SIGN IN | live 26/26 against source backend; production 530 | public-launch/15 |
| DEVICE REGISTRATION | live PASS; revoke fails closed | public-launch/16 |
| POLICY BOOTSTRAP | ABSENT | public-launch/14 |
| BACKEND CONNECTION | local yes / production no | public-launch/17 |
| LIVE AI AVAILABILITY | gateway status configured (local) | public-launch-002/07 |
| USER TASK → POLICY → ADMISSIBLE → EXECUTION → EVIDENCE | live loop COMPLETED, nonce in answer | public-launch/20 |
| VERIFICATION | independent read-back exists (CST); Computer-A verifier ABSENT | public-launch/25 |
| USER RESULT | truthful terminal state | public-launch/20 |
