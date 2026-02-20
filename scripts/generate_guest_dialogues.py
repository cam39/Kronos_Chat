import json
import os
import sys

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.normpath(os.path.join(base_dir, "..", "static", "data"))
    src = os.path.join(data_dir, "guest_dialogues.json")
    dst = os.path.join(data_dir, "guest_dialogues_expanded.json")
    with open(src, "r", encoding="utf-8") as f:
        data = json.load(f)
    scenes = list(data.get("scenes", []))
    for t in data.get("templates", []):
        try:
            count = int(t.get("count", 0))
        except:
            count = 0
        if count <= 0:
            continue
        prefix = str(t.get("prefix", "auto"))
        node = t.get("node") or "auto"
        text_tpl = str(t.get("text", ""))
        vars_obj = t.get("vars") or {}
        cont_label = t.get("continue_label") or "Continuer"
        branch_label = t.get("branch_label") or "Explorer"
        exit_label = t.get("exit_label") or "Quitter"
        branch_next = t.get("branch_next") or "resilience"
        end1 = t.get("end1") or "ending_observer"
        end2 = t.get("end2") or "ending_ghost"
        for i in range(1, count + 1):
            idv = f"{prefix}_{i}"
            next_id = f"{prefix}_{i+1}" if i < count else end1
            txt = text_tpl.replace("{i}", str(i))
            scene = {
                "id": idv,
                "node": node,
                "text": txt,
                "vars": vars_obj,
                "choices": [
                    {"id": f"{idv}_cont", "label": cont_label, "next": next_id},
                    {"id": f"{idv}_branch", "label": branch_label, "next": branch_next},
                    {"id": f"{idv}_exit", "label": exit_label, "next": end2}
                ]
            }
            scenes.append(scene)
    out = {"meta": data.get("meta", {}), "scenes": scenes}
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    try:
        with open(dst, "r", encoding="utf-8") as f:
            print(sum(1 for _ in f))
    except:
        pass

if __name__ == "__main__":
    sys.exit(main())
