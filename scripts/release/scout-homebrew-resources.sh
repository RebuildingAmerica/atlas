#!/usr/bin/env sh

write_dependency_names() {
  names_path=$1
  requirements_path=$2

  uv --directory scout export --no-dev --format requirements-txt >"$requirements_path"
  awk '
    /^[[:alnum:]_.-]+==/ {
      name = $1
      sub(/==.*/, "", name)
      print name
    }
  ' "$requirements_path" | sort -u >"$names_path"
}

write_resources() {
  names_path=$1
  resources_path=$2

  awk -v wanted_file="$names_path" '
    BEGIN {
      while ((getline line < wanted_file) > 0) {
        wanted[line] = 1
      }
      close(wanted_file)
      reset_package()
    }

    function reset_package() {
      package_name = ""
      sdist_url = ""
      sdist_hash = ""
      wheel_url = ""
      wheel_hash = ""
      wheel_score_value = 999
    }

    function wheel_score(url) {
      if (url ~ /py3-none-any\.whl$/) {
        return 1
      }
      if (url ~ /py3-none-macosx_11_0_universal2\.whl$/) {
        return 2
      }
      if (url ~ /py3-none-macosx_10_15_universal2\.whl$/) {
        return 3
      }
      if (url ~ /py3-none-macosx_10_13_universal2\.whl$/) {
        return 4
      }
      return 99
    }

    function field_value(line, key, value) {
      value = line
      sub(".*" key " = \"", "", value)
      sub("\".*", "", value)
      return value
    }

    function remember_wheel(line, url, hash, score) {
      url = field_value(line, "url")
      hash = field_value(line, "hash")
      sub(/^sha256:/, "", hash)
      score = wheel_score(url)
      if (wheel_url == "" || score < wheel_score_value) {
        wheel_url = url
        wheel_hash = hash
        wheel_score_value = score
      }
    }

    function emit_package() {
      if (package_name == "" || !wanted[package_name]) {
        return
      }
      if (package_name ~ /^atlas-/) {
        return
      }
      if (sdist_url != "") {
        printf "  resource \"%s\" do\n", package_name
        printf "    url \"%s\"\n", sdist_url
        printf "    sha256 \"%s\"\n", sdist_hash
        printf "  end\n"
        return
      }
      if (wheel_url != "") {
        printf "  resource \"%s\" do\n", package_name
        printf "    url \"%s\"\n", wheel_url
        printf "    sha256 \"%s\"\n", wheel_hash
        printf "  end\n"
        return
      }
      printf "scout/uv.lock package %s has no installable source\n", package_name > "/dev/stderr"
      failed = 1
    }

    /^\[\[package\]\]$/ {
      emit_package()
      reset_package()
      next
    }

    /^name = "/ {
      package_name = field_value($0, "name")
      next
    }

    /^sdist = / {
      sdist_url = field_value($0, "url")
      sdist_hash = field_value($0, "hash")
      sub(/^sha256:/, "", sdist_hash)
      next
    }

    /^[[:space:]]*\{ url = ".*\.whl"/ {
      remember_wheel($0)
      next
    }

    END {
      emit_package()
      if (failed) {
        exit 1
      }
    }
  ' scout/uv.lock >"$resources_path"
}
