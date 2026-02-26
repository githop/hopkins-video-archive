#!/usr/bin/env python3
"""Patch rope validation bug in transformers for Qwen3.5 support"""

import transformers
import os

# Find the file
base_path = os.path.dirname(transformers.__file__)
file_path = os.path.join(base_path, 'modeling_rope_utils.py')

# Read and fix
with open(file_path, 'r') as f:
    content = f.read()

# Fix the type error - replace the problematic line
old_pattern = 'ignore_keys_at_rope_validation = ignore_keys_at_rope_validation | {"partial_rotary_factor"}'
new_pattern = 'ignore_keys_at_rope_validation = set(ignore_keys_at_rope_validation) | {"partial_rotary_factor"}'

if old_pattern in content:
    content = content.replace(old_pattern, new_pattern)
    with open(file_path, 'w') as f:
        f.write(content)
    print("Successfully patched rope_utils.py")
else:
    print("Pattern not found - may already be fixed or line changed")
