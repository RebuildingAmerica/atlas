#!/usr/bin/env bash
# Auto-format commit message body prose.
#
# Usage:
#   format-commit-message.sh <commit_msg_file>
#
# The title is left untouched. Plain body prose is wrapped to 72 columns.
# Comments, trailers, blank lines, code fences, and structured lines are
# preserved so the hook does not rewrite intentional message structure.

set -euo pipefail

MAX_BODY_LINE_LENGTH=72

if [[ $# -ne 1 ]]; then
    echo "ERROR: Expected one argument: <commit_msg_file>" >&2
    exit 1
fi

message_file="$1"
if [[ ! -f "$message_file" ]]; then
    echo "ERROR: Commit message file not found: $message_file" >&2
    exit 1
fi

if [[ ! -s "$message_file" ]]; then
    exit 0
fi

is_footer_line() {
    local line="$1"
    [[ "$line" =~ ^(BREAKING[[:space:]]CHANGE:|[A-Za-z][A-Za-z-]*:|Fixes[[:space:]]#|Closes[[:space:]]#|Related[[:space:]]to[[:space:]]#|Refs:|Co-Authored-By:|Co-authored-by:|Signed-off-by:|Reviewed-by:|Acked-by:) ]]
}

is_fence_line() {
    local line="$1"
    local trimmed="${line#"${line%%[![:space:]]*}"}"
    [[ "$trimmed" == '```'* || "$trimmed" == '~~~'* ]]
}

wrap_text() {
    local width="$1"
    if command -v fmt >/dev/null 2>&1; then
        fmt -w "$width" -s
    else
        fold -s -w "$width"
    fi
}

wrap_body_line() {
    local line="$1"
    local line_length=${#line}

    if [[ $line_length -le $MAX_BODY_LINE_LENGTH ]]; then
        printf '%s\n' "$line"
        return
    fi

    local bullet_re='^([[:space:]]*([-*+]|[0-9]+[.)])[[:space:]]+)(.*)$'
    if [[ "$line" =~ $bullet_re ]]; then
        local prefix="${BASH_REMATCH[1]}"
        local content="${BASH_REMATCH[3]}"
        local continuation_prefix
        continuation_prefix="$(printf '%*s' "${#prefix}" "")"
        local width=$((MAX_BODY_LINE_LENGTH - ${#prefix}))
        if [[ $width -lt 20 ]]; then
            width=20
        fi

        local wrapped
        wrapped="$(printf '%s\n' "$content" | wrap_text "$width")"
        local first=1
        local segment=""
        while IFS= read -r segment; do
            if [[ $first -eq 1 ]]; then
                printf '%s%s\n' "$prefix" "$segment"
                first=0
            else
                printf '%s%s\n' "$continuation_prefix" "$segment"
            fi
        done <<< "$wrapped"
        return
    fi

    if [[ "$line" =~ ^([[:space:]]+)(.+)$ ]]; then
        local prefix="${BASH_REMATCH[1]}"
        local content="${BASH_REMATCH[2]}"
        local width=$((MAX_BODY_LINE_LENGTH - ${#prefix}))
        if [[ $width -lt 20 ]]; then
            width=20
        fi

        local wrapped
        wrapped="$(printf '%s\n' "$content" | wrap_text "$width")"
        local segment=""
        while IFS= read -r segment; do
            printf '%s%s\n' "$prefix" "$segment"
        done <<< "$wrapped"
        return
    fi

    printf '%s\n' "$line" | wrap_text "$MAX_BODY_LINE_LENGTH"
}

lines=()
while IFS= read -r line || [[ -n "$line" ]]; do
    lines+=("${line%$'\r'}")
done < "$message_file"
if [[ ${#lines[@]} -eq 0 ]]; then
    exit 0
fi

title="${lines[0]}"
if [[ "$title" =~ ^(Merge|Revert[[:space:]]\"|fixup!|squash!) ]]; then
    exit 0
fi

footer_start=${#lines[@]}
index=$((${#lines[@]} - 1))
while [[ $index -ge 1 ]]; do
    line="${lines[$index]}"
    if [[ -z "$line" ]]; then
        if [[ $footer_start -lt ${#lines[@]} ]]; then
            break
        fi
        index=$((index - 1))
        continue
    fi

    if is_footer_line "$line"; then
        footer_start=$index
        index=$((index - 1))
        continue
    fi

    break
done

tmp_file="$(mktemp "${TMPDIR:-/tmp}/commit-msg-format.XXXXXX")"
trap 'rm -f "$tmp_file"' EXIT

printf '%s\n' "$title" > "$tmp_file"
in_fence=0
for ((index = 1; index < ${#lines[@]}; index++)); do
    line="${lines[$index]}"

    if [[ $index -ge $footer_start ]]; then
        printf '%s\n' "$line" >> "$tmp_file"
        continue
    fi

    if is_fence_line "$line"; then
        printf '%s\n' "$line" >> "$tmp_file"
        if [[ $in_fence -eq 0 ]]; then
            in_fence=1
        else
            in_fence=0
        fi
        continue
    fi

    if [[ $in_fence -eq 1 || "$line" == \#* || -z "$line" ]]; then
        printf '%s\n' "$line" >> "$tmp_file"
        continue
    fi

    wrap_body_line "$line" >> "$tmp_file"
done

if ! cmp -s "$message_file" "$tmp_file"; then
    cat "$tmp_file" > "$message_file"
    echo "Auto-formatted commit body to 72 columns."
fi
