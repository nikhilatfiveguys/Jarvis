#!/usr/bin/env python3
"""
Remove com.apple.provenance extended attribute from files
This handles binary attributes that xattr can't remove
"""
import sys
import subprocess
import os

def remove_provenance(file_path):
    """Remove com.apple.provenance attribute using xattr"""
    try:
        # Try to remove the attribute
        result = subprocess.run(['xattr', '-d', 'com.apple.provenance', file_path], 
                              capture_output=True, text=True)
        if result.returncode == 0:
            return True
        
        # If that fails, try to clear all attributes
        subprocess.run(['xattr', '-c', file_path], capture_output=True)
        return True
    except Exception as e:
        print(f"Error removing provenance from {file_path}: {e}", file=sys.stderr)
        return False

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: remove-provenance.py <file>", file=sys.stderr)
        sys.exit(1)
    
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}", file=sys.stderr)
        sys.exit(1)
    
    if remove_provenance(file_path):
        print(f"✅ Removed provenance from {file_path}")
        sys.exit(0)
    else:
        print(f"❌ Failed to remove provenance from {file_path}", file=sys.stderr)
        sys.exit(1)










