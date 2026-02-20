# Dialogues v2.0

- Univers: Kronos - Marches Ombreuses
- Époque: fantaisie sombre, pré‑industrielle
- Registre: oral, vif, images concrètes, touches d'ironie

Structure des fichiers
- /locales/<lang>/manifest.json — index des packs pour la langue
- /locales/<lang>/packs/pack_XXX.json — scènes shardées (UTF‑8, fins de ligne UNIX)
- Dialogue_Master.xlsx — classeur maître (généré par pipeline) avec onglets: Script, Métadonnées, Glossaire
- coverage_report.json — rapport de couverture agrégé

Métadonnées par réplique
- id (unique), node, speaker, text, subtitle (≤42), vars (emotion, quest_stage…), conditions, duration_ms, tags, choices[{id,label,next}]
- Variables supportées: ${player_name}, ${quest_stage}, ${item_count}

Pipeline (génération massive)
- Script: pipeline/build_dialogue_assets.py
- Exemples:
  - Générer un échantillon: python pipeline/build_dialogue_assets.py --sample_only
  - Générer ×100 multilingue: python pipeline/build_dialogue_assets.py --scale 100

Tests et conformité
- Suite: pipeline/test_dialogues.py
- Valide unicité des IDs, longueur de sous‑titres ≤42, présence de variables dynamiques

Intégration
- Charger manifest.json de la locale puis concaténer les packs. Les champs non utilisés par le moteur actuel peuvent être ignorés sans erreur.

