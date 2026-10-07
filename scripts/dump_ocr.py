import os
import glob
import json
import Vision
import Quartz
from Cocoa import NSURL

def ocr_image(image_path):
    input_url = NSURL.fileURLWithPath_(image_path)
    request_handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(input_url, None)
    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLanguages_(['zh-Hans', 'en-US'])
    request.setUsesLanguageCorrection_(True)
    request_handler.performRequests_error_([request], None)
    results = request.results()
    texts = []
    if results:
        for observation in results:
            texts.append(observation.text())
    return texts

def scan_all():
    image_paths = sorted(glob.glob('/Users/nanshi1/Documents/4_github_repos/running-analyzer/screenshots/*.*'))
    ocr_results = {}
    for p in image_paths:
        fname = os.path.basename(p)
        try:
            texts = ocr_image(p)
            ocr_results[fname] = texts
            print(f"Parsed {fname}: {len(texts)} lines")
        except Exception as e:
            print(f"Error {fname}: {e}")
            ocr_results[fname] = []
    
    with open('/Users/nanshi1/Documents/4_github_repos/running-analyzer/scripts/ocr_dump.json', 'w', encoding='utf-8') as f:
        json.dump(ocr_results, f, ensure_ascii=False, indent=2)

if __name__ == '__main__':
    scan_all()
