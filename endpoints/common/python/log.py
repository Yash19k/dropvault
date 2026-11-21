'''Logging setup shared by every Lambda (one line per record, INFO and up).'''

import logging


def setup_logging():
    '''Return the root logger with a single, consistently formatted handler.'''
    logger = logging.getLogger()
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s - %(funcName)s - %(levelname)s - %(message)s'))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger
