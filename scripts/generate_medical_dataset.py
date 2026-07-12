from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI


PROJECT_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_DIR / "sample_data"
OUTPUT_PATH = OUTPUT_DIR / "medical_knowledge_800.md"

for env_path in (PROJECT_DIR / ".env", PROJECT_DIR.parent / ".env"):
    if env_path.exists():
        load_dotenv(env_path)

DISEASES = [
    "高血压", "冠心病", "心力衰竭", "心房颤动", "心肌炎", "扩张型心肌病", "心脏瓣膜病", "深静脉血栓", "下肢静脉曲张", "高脂血症",
    "普通感冒", "流行性感冒", "急性支气管炎", "社区获得性肺炎", "支气管哮喘", "慢性阻塞性肺疾病", "肺结核", "阻塞性睡眠呼吸暂停", "肺癌", "自发性气胸",
    "胃食管反流病", "慢性胃炎", "消化性溃疡", "急性胃肠炎", "肠易激综合征", "溃疡性结肠炎", "非酒精性脂肪性肝病", "慢性乙型肝炎", "胆囊结石", "急性胰腺炎",
    "1型糖尿病", "2型糖尿病", "甲状腺功能亢进症", "甲状腺功能减退症", "痛风", "骨质疏松症", "肥胖症", "代谢综合征", "肾上腺皮质功能减退症", "垂体腺瘤",
    "偏头痛", "紧张型头痛", "癫痫", "缺血性脑卒中", "出血性脑卒中", "帕金森病", "阿尔茨海默病", "周围神经病", "面神经炎", "脑膜炎",
    "骨关节炎", "类风湿关节炎", "强直性脊柱炎", "腰椎间盘突出症", "颈椎病", "肩周炎", "腕管综合征", "骨折", "踝关节扭伤", "肌腱炎",
    "特应性皮炎", "银屑病", "荨麻疹", "痤疮", "带状疱疹", "体癣", "蜂窝织炎", "白癜风", "斑秃", "黑色素瘤",
    "过敏性鼻炎", "慢性鼻窦炎", "急性中耳炎", "扁桃体炎", "喉炎", "白内障", "青光眼", "结膜炎", "干眼症", "年龄相关性黄斑变性",
    "尿路感染", "肾结石", "慢性肾脏病", "肾小球肾炎", "良性前列腺增生", "慢性前列腺炎", "子宫内膜异位症", "多囊卵巢综合征", "阴道炎", "盆腔炎",
    "抑郁障碍", "广泛性焦虑障碍", "双相情感障碍", "精神分裂症", "失眠障碍", "惊恐障碍", "强迫症", "注意缺陷多动障碍", "孤独症谱系障碍", "神经性厌食症",
]

FIELDS = ["疾病名称", "疾病类别", "典型症状", "常用检查", "治疗原则", "可用药物", "建议科室", "就医提示"]


def extract_json(text: str) -> list[dict[str, str]]:
    match = re.search(r"\[[\s\S]*\]", text)
    if not match:
        raise ValueError("model response does not contain a JSON array")
    data = json.loads(match.group(0))
    if not isinstance(data, list):
        raise ValueError("model response is not a list")
    return data


def generate_batch(client: OpenAI, model: str, names: list[str]) -> list[dict[str, str]]:
    prompt = f"""
请为教学演示用医疗知识图谱生成结构化知识。疾病列表：{json.dumps(names, ensure_ascii=False)}

严格返回 JSON 数组，每个疾病一个对象，并且只能包含以下 8 个字符串字段：
{json.dumps(FIELDS, ensure_ascii=False)}

要求：
1. 疾病名称必须与给定列表完全一致，顺序一致，不遗漏。
2. 典型症状列出 3-4 项；常用检查列出 2-4 项；可用药物列出 1-4 个常用通用名或药物类别。
3. 治疗原则使用简洁、规范的医学表述；建议科室使用中国医院常见科室名称。
4. 就医提示必须指出需要急诊的危险征象，或说明由医生评估确诊。
5. 不写药物剂量，不做个体化处方，不使用偏方，不承诺疗效。
6. 内容参考 MedlinePlus、WHO、NHS 等权威公开健康资料的一般性共识，使用中文。
7. 只输出 JSON，不要 Markdown，不要解释。
"""
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "你是严谨的医学知识库编辑，只生成一般性健康教育内容，不替代医生诊疗。"},
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        timeout=120,
    )
    items = extract_json(response.choices[0].message.content or "")
    if len(items) != len(names):
        raise ValueError(f"expected {len(names)} items, got {len(items)}")
    for expected_name, item in zip(names, items):
        if item.get("疾病名称") != expected_name:
            raise ValueError(f"disease order mismatch: {expected_name} != {item.get('疾病名称')}")
        missing = [field for field in FIELDS if not isinstance(item.get(field), str) or not item[field].strip()]
        if missing:
            raise ValueError(f"{expected_name} missing fields: {missing}")
    return items


def render_markdown(items: list[dict[str, str]]) -> str:
    lines = [
        "# 医疗知识图谱演示数据集（合成教学版）",
        "",
        "> 本数据集用于 GraphRAG Studio 课程演示，不构成诊断、处方或治疗建议。出现严重或持续症状时应及时就医。药物必须由医生或药师结合个体情况评估后使用。",
        "",
        "## 数据说明",
        "",
        f"- 疾病条目：{len(items)} 个",
        f"- 每个疾病知识字段：{len(FIELDS)} 条",
        f"- 结构化知识总数：{len(items) * len(FIELDS)} 条",
        "- 关系构建方式：同一疾病页中的疾病、症状、检查、治疗、药物和科室建立共现关系。",
        "- 内容性质：基于权威公开健康资料的一般性共识生成的合成教学数据，已避免剂量和个体化处方。",
        "",
        "## 权威资料入口",
        "",
        "- MedlinePlus Health Topics：https://medlineplus.gov/healthtopics.html",
        "- World Health Organization Health Topics：https://www.who.int/health-topics",
        "- NHS Conditions：https://www.nhs.uk/conditions/",
        "",
    ]
    for index, item in enumerate(items, start=1):
        lines.extend([f"[Page {index}]", f"## {index:03d}. {item['疾病名称']}", ""])
        for field_index, field in enumerate(FIELDS, start=1):
            value = item[field].replace("\n", " ").strip()
            lines.append(f"{field_index}. {field}：{value}")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def main() -> None:
    api_key = os.getenv("SILICONFLOW_API_KEY", "")
    if not api_key:
        raise SystemExit("SILICONFLOW_API_KEY is not configured")
    client = OpenAI(
        api_key=api_key,
        base_url=os.getenv("SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1"),
    )
    model = os.getenv("SILICONFLOW_MODEL", "Pro/zai-org/GLM-5.1")
    records: list[dict[str, str]] = []
    for offset in range(0, len(DISEASES), 10):
        names = DISEASES[offset : offset + 10]
        for attempt in range(1, 4):
            try:
                batch = generate_batch(client, model, names)
                records.extend(batch)
                print(f"generated {len(records)}/{len(DISEASES)}")
                break
            except Exception as exc:
                if attempt == 3:
                    raise
                print(f"batch {offset // 10 + 1} attempt {attempt} failed: {exc}")
                time.sleep(2 * attempt)
    if len(records) != 100:
        raise SystemExit(f"expected 100 records, got {len(records)}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(render_markdown(records), encoding="utf-8")
    print(f"wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
