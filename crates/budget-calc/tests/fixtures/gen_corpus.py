# Regenerates the voice fixture corpus `tests/voice_models.rs` expects:
#
#   python3 crates/budget-calc/tests/fixtures/gen_corpus.py <dir>
#   BUDGET_VOICE_FIXTURES=<dir> cargo test --release -p budget-calc \
#     --features voice,voice-cmn --test voice_models -- --ignored
#
# macOS only: the clips come from `say`, which is deterministic for a
# given voice, so two runs of this script produce identical WAVs and the
# corpus is a fixed target rather than a moving one. It lives here, in
# the repo, because the corpus the original 88%/50-clip figure was
# measured on was kept outside it and is now gone -- which made that
# number unreproducible and is exactly what this file prevents.
# <lang>/manifest.tsv of "<file>\t<said>" plus 16kHz mono 16-bit WAVs.
# The reference sentence IS the ground truth -- the harness parses it
# with the same parser it parses the transcript with -- so the only
# requirement on these lines is that they be things a person would say
# and that they use vocabulary the alias tables actually carry.
import os, subprocess, sys

EN = [
 ("primaryEarnedIncome", ["salary three thousand dollars","got paid two thousand five hundred dollars salary","paycheck one thousand eight hundred dollars"]),
 ("selfEmploymentBusiness", ["freelance income six hundred dollars","consulting payment one thousand two hundred dollars","side hustle two hundred fifty dollars"]),
 ("investmentCapitalIncome", ["dividends ninety dollars","interest income forty five dollars","stocks three hundred dollars"]),
 ("governmentSupplemental", ["unemployment benefits four hundred dollars","social security nine hundred dollars","government benefits two hundred dollars"]),
 ("otherIncome", ["other income fifty dollars","misc income twenty five dollars","other income one hundred ten dollars"]),
 ("housing", ["paid eight hundred dollars rent","mortgage one thousand four hundred dollars","housing seven hundred fifty dollars"]),
 ("utilities", ["electricity sixty dollars","water bill thirty five dollars","internet bill fifty five dollars"]),
 ("foodGroceries", ["add expense twelve dollars groceries","spent forty dollars on restaurant","takeout eighteen dollars"]),
 ("transportation", ["spent forty five dollars on transportation","uber twenty two dollars","parking eight dollars"]),
 ("healthcareInsurance", ["add expense ninety nine dollars for insurance","doctor one hundred fifty dollars","pharmacy thirty dollars"]),
 ("debtServicing", ["paid four hundred fifty dollars student loan","credit card payment two hundred dollars","loan three hundred twenty dollars"]),
 ("personalLifestyle", ["spent sixty dollars on clothes","movies fifteen dollars","shopping eighty five dollars"]),
 ("subscriptionsMemberships", ["netflix subscription fifteen dollars","gym membership forty dollars","spotify ten dollars"]),
 ("familyDependents", ["childcare six hundred dollars","school two hundred dollars","kids ninety dollars"]),
 ("giftsDonations", ["charity fifty dollars","gift thirty five dollars","donation one hundred dollars"]),
 ("otherExpenses", ["miscellaneous twenty dollars","other expense forty five dollars","misc thirty dollars"]),
]

ZH = [
 ("primaryEarnedIncome", ["工资三万元","发了薪水两万五千元","奖金八千元"]),
 ("selfEmploymentBusiness", ["自由职业收入六千元","咨询费一万两千元","兼职两千五百元"]),
 ("investmentCapitalIncome", ["分红九百元","利息四百五十元","股票三千元"]),
 ("governmentSupplemental", ["福利四千元","养老金九千元","退税两千元"]),
 ("otherIncome", ["其他收入五百元","外快两百五十元","红包一千一百元"]),
 ("housing", ["交了八千元房租","房贷一万四千元","物业费七百五十元"]),
 ("utilities", ["电费六百元","水费三百五十元","网费五百五十元"]),
 ("foodGroceries", ["今天杂货花了一百二十元","餐厅花了四百元","外卖一百八十元"]),
 ("transportation", ["交通费花了四百五十元","打车两百二十元","停车费八十元"]),
 ("healthcareInsurance", ["保险费九百九十元","看病一千五百元","药三百元"]),
 ("debtServicing", ["还款四千五百元","信用卡还款两千元","学生贷款三千两百元"]),
 ("personalLifestyle", ["衣服花了六百元","电影一百五十元","购物八百五十元"]),
 ("subscriptionsMemberships", ["订阅一百五十元","健身房四百元","会员一百元"]),
 ("familyDependents", ["托儿费六千元","学费两千元","孩子九百元"]),
 ("giftsDonations", ["慈善五百元","礼物三百五十元","捐款一千元"]),
 ("otherExpenses", ["杂项两百元","其他支出四百五十元","其他三百元"]),
]

YUE = [
 ("primaryEarnedIncome", ["人工三萬蚊","出咗薪水兩萬五千蚊","花紅八千蚊"]),
 ("selfEmploymentBusiness", ["自由職業收入六千蚊","顧問費一萬二千蚊","兼職兩千五百蚊"]),
 ("investmentCapitalIncome", ["股息九百蚊","利息四百五十蚊","股票三千蚊"]),
 ("governmentSupplemental", ["政府福利四千蚊","退休金九千蚊","退稅兩千蚊"]),
 ("otherIncome", ["其他收入五百蚊","外快兩百五十蚊","利是一千一百蚊"]),
 ("housing", ["交咗八千蚊屋租","供樓一萬四千蚊","管理費七百五十蚊"]),
 ("utilities", ["電費六百蚊","水費三百五十蚊","上網費五百五十蚊"]),
 ("foodGroceries", ["今日買餸用咗一百二十蚊","食飯用咗四百蚊","外賣一百八十蚊"]),
 ("transportation", ["車錢用咗四百五十蚊","的士兩百二十蚊","泊車八十蚊"]),
 ("healthcareInsurance", ["保險九百九十蚊","睇醫生一千五百蚊","買藥三百蚊"]),
 ("debtServicing", ["還款四千五百蚊","卡數兩千蚊","學生貸款三千二百蚊"]),
 ("personalLifestyle", ["買衫用咗六百蚊","睇戲一百五十蚊","買手機八百五十蚊"]),
 ("subscriptionsMemberships", ["訂閱一百五十蚊","健身四百蚊","會籍一百蚊"]),
 ("familyDependents", ["託兒費六千蚊","學費兩千蚊","小朋友九百蚊"]),
 ("giftsDonations", ["慈善五百蚊","禮物三百五十蚊","捐款一千蚊"]),
 ("otherExpenses", ["雜項兩百蚊","其他支出四百五十蚊","其他三百蚊"]),
]

LANGS = {"en": (EN, "Samantha"), "zh": (ZH, "Tingting")}
root = sys.argv[1]
for lang, (data, voice) in LANGS.items():
    d = os.path.join(root, lang)
    os.makedirs(d, exist_ok=True)
    rows, i = [], 0
    for cat, lines in data:
        for line in lines:
            i += 1
            name = f"{lang}{i:03d}.wav"
            subprocess.run(["say", "-v", voice, "-o", os.path.join(d, name),
                            "--data-format=LEI16@16000", line], check=True)
            rows.append(f"{name}\t{line}")
    open(os.path.join(d, "manifest.tsv"), "w").write("\n".join(rows) + "\n")
    print(f"{lang}: {len(rows)} clips, voice {voice}")
