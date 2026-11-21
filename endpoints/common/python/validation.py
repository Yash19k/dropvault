'''JSON Schema validation for request bodies (needs the jsonschema layer).'''

import json
from os.path import dirname, join


def validate_body(body, handler_file, schema_name):
    '''(True, None) if body matches schemas/<schema_name> next to handler_file,
       else (False, the first error message).'''
    import jsonschema  # only the Lambdas that validate carry this layer
    with open(join(dirname(handler_file), 'schemas', schema_name)) as handle:
        schema = json.load(handle)
    try:
        jsonschema.validate(body, schema)
        return True, None
    except jsonschema.exceptions.ValidationError as error:
        return False, error.message
