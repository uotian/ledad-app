import re

from ..storage.files import compact


def prompt_cache_request(model, instructions, data, stable_keys=None, history_key=None):
    version = re.match(r"^gpt-(\d+)(?:\.(\d+))?(?:-|$)", model)
    explicit = version and (
        int(version[1]) >= 6 or (int(version[1]) == 5 and int(version[2] or 0) >= 6)
    )
    if stable_keys is None or not explicit or not isinstance(data, dict):
        return {"instructions": instructions, "input": compact(data)}
    content = []

    def add(text, cache=False):
        item = {"type": "input_text", "text": text}
        if cache:
            item["prompt_cache_breakpoint"] = {"mode": "explicit"}
        content.append(item)

    stable = compact({k: v for k, v in data.items() if k in stable_keys})
    prefix, separator = stable[:-1], "" if stable == "{}" else ","
    if stable != "{}":
        add(prefix, True)
        prefix = ""
    history = data.get(history_key)
    if history_key and isinstance(history, list):
        prefix += separator + compact(history_key) + ":["
        for index, entry in enumerate(history):
            add((prefix if index == 0 else ",") + compact(entry), True)
        prefix = ("" if history else prefix) + "]"
        separator = ","
    rest = compact(
        {
            k: v
            for k, v in data.items()
            if k not in stable_keys and not (isinstance(history, list) and k == history_key)
        }
    )[1:-1]
    add(prefix + (separator + rest if rest else "") + "}")
    return {
        "prompt_cache_options": {"mode": "explicit", "ttl": "30m"},
        "input": [
            {
                "role": "developer",
                "content": [
                    {
                        "type": "input_text",
                        "text": instructions,
                        "prompt_cache_breakpoint": {"mode": "explicit"},
                    }
                ],
            },
            {"role": "user", "content": content},
        ],
    }
