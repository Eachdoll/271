# 읽기 어휘 데이터

Dolch 공개 sight-word 목록: pre-primer 40개, primer 52개, first grade 41개. [목록 참고](https://www.dolchword.net/printables/All220DolchWordsByGrade.pdf). `cvc_short_vowel.txt`는 앱이 만든 짧은 모음 해독 연습 단어 목록입니다. Everyday nouns도 앱이 선정한 일상 명사이며 공인 등급 목록으로 표시하지 않습니다.

`dale_chall.txt`는 MIT [textstat 0.7.10 영어 easy_words 데이터](https://github.com/textstat/textstat/tree/0.7.10/textstat/resources/en)에서 가져왔습니다. 이 단어 데이터만 정적 앱에 포함하며 Python textstat를 설치하거나 실행하지 않습니다. 저작권 고지는 `textstat-data-LICENSE.txt`에 있습니다.

한글 김광해 등급별 어휘 파일은 제공되지 않았으므로 임의로 만든 단어 목록을 해당 자료로 표시하지 않습니다. 한글 목록을 부모가 CSV로 제공하지 않으면 어휘 이탈률 검사는 생략하고 문장 길이와 연결어미 패턴을 검사합니다.

Revised Spache(1974) 목록: [words/spache](https://github.com/words/spache), MIT. 저작권 고지는 `spache-LICENSE.txt`에 있습니다. Fry 목록은 [공개 자료](https://github.com/scholarly/words/blob/master/incoming/fry%27s%201000%20most%20frequent%20words.txt)의 1,000개 자주 쓰는 영어 목록을 정규화했습니다. 단계 검사 어휘와 Spache/Dale–Chall의 친숙 어휘 기준은 서로 분리됩니다.
